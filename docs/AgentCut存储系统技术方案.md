# AgentCut 多用户资产存储系统 — 技术方案

> 角色：资深后端架构师（云存储 / CDN 基础设施）
> 版本：v1.0
> 适用范围：AgentCut 平台多用户资产存储 — 签名直传、生命周期、CDN 加速、rclone 异地备份

---

## 模块一：签名直传（前端直传云存储）

### 1.1 业务流程

```
[前端] 用户选择文件（拖拽/批量）
   │
   ├─ 1. 前端调用 POST /api/asset/upload-sign
   │      │  请求体：{ fileName, fileSize, contentType, folder? }
   │      │  业务服务器校验：用户已登录、文件大小未超限、类型在白名单
   │      └→ 返回：{ uploadUrl, formFields, assetId, cdnUrl }
   │
   ├─ 2. 前端通过 Fetch/XHR 直传云存储（不经过业务服务器）
   │      │  使用签名的 formData / headers
   │      │  监听 onprogress → 前端进度条
   │      └→ 云存储返回 HTTP 200 / 204
   │
   ├─ 3. （推荐）云存储通过回调 URL 通知业务服务器
   │      │  POST /api/asset/callback
   │      │  携带文件元数据 + 签名
   │      └→ 业务服务器验证回调签名，更新 Asset 表状态 confirmed
   │
   └─ 4. 前端拿到 cdnUrl 直接用于展示/下载
```

### 1.2 业务服务器签名接口（Node.js / Next.js API Route）

```typescript
// app/api/asset/upload-sign/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

// ----- 腾讯云 COS 签名核心 -----
function cosAuthorization({
  secretId, secretKey, method, pathname,
  headers = {}, query = {},
  durationSec = 1800,
}: {
  secretId: string;
  secretKey: string;
  method: string;
  pathname: string;   // 如 '/bucket-name/prefix/object.ext'
  headers?: Record<string, string>;
  query?: Record<string, string>;
  durationSec?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const expire = now + durationSec;

  // Step 1: 拼 KeyTime / SignKey
  const keyTime = `${now};${expire}`;
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');

  // Step 2: 拼 HttpString
  const sortedQuery = Object.keys(query).sort().map(k => `${k}=${encodeURIComponent(query[k])}`).join(';');
  const urlParamList = Object.keys(query).sort().join(';');
  const sortedHeaders = Object.keys(headers).sort().map(k => `${k.toLowerCase()}=${encodeURIComponent(headers[k])}`).join(';');
  const headerList = Object.keys(headers).sort().map(k => k.toLowerCase()).join(';');
  const httpString = `${method.toLowerCase()}\n${pathname}\n${sortedQuery}\n${sortedHeaders}\n`;

  // Step 3: 拼 StringToSign
  const sha1Http = crypto.createHash('sha1').update(httpString).digest('hex');
  const stringToSign = `sha1\n${keyTime}\n${sha1Http}\n`;

  // Step 4: 签名
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');

  // Step 5: 返回 Authorization
  return [
    `q-sign-algorithm=sha1`,
    `q-ak=${secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${urlParamList}`,
    `q-signature=${signature}`,
  ].join('&');
}

// ----- 阿里云 OSS 签名（Presigned POST）-----
function ossPresignedPost({
  accessKeyId, accessKeySecret, bucket, region,
  objectKey, contentType, maxSize = 500 * 1024 * 1024,
  durationSec = 1800,
}: {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  objectKey: string;
  contentType: string;
  maxSize?: number;
  durationSec?: number;
}): { url: string; fields: Record<string, string> } {
  const now = new Date();
  const expire = new Date(now.getTime() + durationSec * 1000);

  const policy = JSON.stringify({
    expiration: expire.toISOString(),
    conditions: [
      { bucket },
      { key: objectKey },
      ['content-length-range', 1, maxSize],
      ['starts-with', '$Content-Type', contentType],
    ],
  });

  const base64Policy = Buffer.from(policy).toString('base64');
  const signature = crypto.createHmac('sha1', accessKeySecret).update(base64Policy).digest('base64');

  return {
    url: `https://${bucket}.oss-${region}.aliyuncs.com`,
    fields: {
      key: objectKey,
      OSSAccessKeyId: accessKeyId,
      policy: base64Policy,
      signature,
      'Content-Type': contentType,
    },
  };
}

// ----- 允许的文件类型 -----
const ALLOWED_MIME_WHITELIST = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mp3', 'audio/wav', 'audio/mpeg', 'audio/ogg',
  'audio/flac', 'audio/aac',
  'application/pdf',
  'application/json', 'text/plain',
];

// 按用户等级限制单文件大小（字节）
const SIZE_LIMIT_BY_ROLE: Record<string, number> = {
  user: 500 * 1024 * 1024,       // 500 MB
  paid: 2 * 1024 * 1024 * 1024,  // 2 GB
  admin: 10 * 1024 * 1024 * 1024,// 10 GB（管理员上传后台素材）
};

// ----- API Handler -----
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);  // 校验登录态，未登录返回 401

  const { fileName, fileSize, contentType, folder = 'uploads' } = await req.json();

  // 1. 类型白名单校验
  if (!ALLOWED_MIME_WHITELIST.includes(contentType)) {
    return NextResponse.json({ error: '不支持的文件类型' }, { status: 400 });
  }

  // 2. 大小限制
  const maxSize = SIZE_LIMIT_BY_ROLE[user.role] || SIZE_LIMIT_BY_ROLE.user;
  if (fileSize > maxSize) {
    return NextResponse.json({ error: `文件大小超限（最大 ${maxSize / 1024 / 1024} MB）` }, { status: 400 });
  }

  // 3. 生成唯一对象键
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const objectKey = `${user.id}/${folder}/${crypto.randomUUID()}.${ext}`;

  // 4. 在数据库创建 pending 记录
  const asset = await prisma.asset.create({
    data: {
      id: crypto.randomUUID(),
      userId: user.id,
      fileName,
      fileSize,
      contentType,
      objectKey,
      storageClass: 'STANDARD',
      status: 'pending',       // 待回调确认
      createdAt: new Date(),
    },
  });

  // 5. 生成签名（根据环境变量选 COS / OSS / Qiniu / R2）
  const provider = process.env.STORAGE_PROVIDER || 'cos';  // 'cos' | 'oss' | 'qiniu' | 'r2'

  if (provider === 'cos') {
    const pathname = `/${process.env.COS_BUCKET}/${objectKey}`;
    const auth = cosAuthorization({
      secretId: process.env.COS_SECRET_ID!,
      secretKey: process.env.COS_SECRET_KEY!,
      method: 'put',
      pathname,
      headers: { 'Content-Type': contentType, 'Content-Length': String(fileSize) },
      durationSec: 1800,
    });
    return NextResponse.json({
      assetId: asset.id,
      uploadUrl: `https://${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/${objectKey}`,
      method: 'PUT',
      headers: {
        Authorization: auth,
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
      },
      cdnUrl: `${process.env.CDN_DOMAIN}/${objectKey}`,
    });
  }

  if (provider === 'oss') {
    const presigned = ossPresignedPost({
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
      bucket: process.env.OSS_BUCKET!,
      region: process.env.OSS_REGION!,
      objectKey,
      contentType,
      maxSize,
    });
    return NextResponse.json({
      assetId: asset.id,
      uploadUrl: presigned.url,
      method: 'POST',
      formFields: presigned.fields,
      cdnUrl: `${process.env.CDN_DOMAIN}/${objectKey}`,
    });
  }

  // ... 同理处理 Qiniu（uploadToken）、Cloudflare R2（presigned S3）
}
```

**安全注意事项写在签名接口里，单独强调四点**：

- **时长最小化**：签名有效期 30 分钟，防止被重放攻击循环上传。实际过期由云存储侧校验 `q-sign-time`.
- **Content-Type 固定**：签名里锁死 `contentType`，防止攻击者替换上传文件类型绕过白名单。
- **Size 硬上限**：签名策略包含 `content-length-range`（OSS）或请求头指定 `Content-Length`（COS），由云存储拒绝超大文件，不下到底层接收再拒.
- **回调签名**：云存储回调业务服务器时会携带 `x-cos-signature`（COS）或 `x-oss-callback` 签名，业务服务器**必须校验**回调合法性，否则攻击者可直接 POST 伪造上传成功记录。

### 1.3 前端上传代码（带进度与断点续传思路）

```typescript
// lib/asset/upload.ts
interface UploadChunk {
  index: number;          // 分片索引（0 起始）
  start: number;          // 字节起始
  end: number;            // 字节结束
  done: boolean;          // 是否已上传
}

async function uploadFile(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ assetId: string; cdnUrl: string }> {
  // 1. 请求业务服务器签名
  const signResp = await fetch('/api/asset/upload-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type,
    }),
  });
  const { assetId, uploadUrl, method, headers, formFields, cdnUrl } = await signResp.json();

  // ---- 方案 A：小文件（< 50 MB）直接 PUT ----
  if (file.size < 50 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, uploadUrl);
      if (headers) {
        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v as string));
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 204) resolve({ assetId, cdnUrl });
        else reject(new Error(`上传失败: HTTP ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('网络错误'));
      xhr.upload.onabort = () => reject(new Error('上传被取消'));

      if (formFields) {
        // OSS POST 模式
        const fd = new FormData();
        Object.entries(formFields).forEach(([k, v]) => fd.append(k, v as string));
        fd.append('file', file);  // OSS 要求 file 放在最后
        xhr.send(fd);
      } else {
        xhr.send(file);
      }
    });
  }

  // ---- 方案 B：大文件分片上传（断点续传基础）----
  // 使用 COS 分片上传 / OSS 分片上传 API
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // 将文件分片缓存到 IndexedDB（断点续传核心——切片不被内存 GC）
  const chunkStore = await openChunkDB();  // IndexedDB wrapper
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    await chunkStore.put(file.slice(start, end), `${assetId}_${i}`);
  }

  let uploadedChunks = 0;
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await chunkStore.get(`${assetId}_${i}`);
    // 每个分片独立签名（生产环境通过 POST /api/asset/upload-part 获取分片签名）
    const partSig = await fetch('/api/asset/upload-part', {
      method: 'POST',
      body: JSON.stringify({ assetId, partNumber: i + 1 }),
    }).then(r => r.json());

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', partSig.uploadUrl);
    xhr.setRequestHeader('Authorization', partSig.auth);
    await new Promise<void>((res, rej) => {
      xhr.onload = () => (xhr.status === 200 ? res() : rej());
      xhr.onerror = rej;
      xhr.send(chunk.blob);
    });

    uploadedChunks++;
    onProgress(Math.round((uploadedChunks / totalChunks) * 100));
  }

  // 全部上传完成 → 合并分片
  await fetch('/api/asset/complete-upload', {
    method: 'POST',
    body: JSON.stringify({ assetId }),
  });

  return { assetId, cdnUrl };
}
```

**断点续传要点**（上文 `IndexedDB` 分片存储是核心动机）:
- 每个分片存入 `IndexedDB`，即使关闭浏览器/网络断开，重启页面后扫描已有分片，跳过已上传的。
- 分片签名应每片独立申请（且单片签名有效期短于整片重传窗口）。
- 上传中断后，可从 `localStorage` 恢复 `{ assetId, chunksDone: [0,1,2,5,7] }` 继续。

### 1.4 回调接口（云存储 → 业务服务器）

```typescript
// app/api/asset/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

// COS 回调签名校验
function verifyCosCallback(req: NextRequest): boolean {
  const sigHeader = req.headers.get('x-cos-signature');
  const secretKey = process.env.COS_SECRET_KEY!;
  // COS 回调签名为 sha1 摘要 + Base64，用 secretKey 做 HMAC
  const rawBody = (req as any).rawBody;  // Next.js 需要配置 rawBody 读取
  const expectSig = crypto.createHmac('sha1', secretKey).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(sigHeader!), Buffer.from(expectSig));
}

export async function POST(req: NextRequest) {
  // 1. 验证回调来源
  if (!verifyCosCallback(req)) {
    return NextResponse.json({ error: '签名校验失败' }, { status: 403 });
  }

  // 2. 解析回调参数（COS 回调 body 为 JSON）
  const body = await req.json();

  const objectKey: string = body.key || body.object;         // 对象键
  const fileSize: number = parseInt(body.size, 10);          // 实际文件大小（不可信前端的）
  const etag: string = body.eTag || body.etag;               // 文件指纹

  // 3. 找到对应的 pending Asset，更新为 confirmed
  const asset = await prisma.asset.findFirst({
    where: { objectKey, status: 'pending' },
  });
  if (!asset) {
    return NextResponse.json({ error: 'Asset 不存在或已确认' }, { status: 404 });
  }

  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      status: 'confirmed',
      fileSize,            // 以回调上报的实际大小为准
      etag,                // 保存 etag 供后续完整性校验
      storageClass: 'STANDARD',
      confirmedAt: new Date(),
    },
  });

  // 4. 可选：触发异步处理流水线（转码缩略图 / 病毒扫描 / 内容审核）
  //    await enqueueAssetPipeline(asset.id);

  return NextResponse.json({ code: 0, message: 'ok' });
}

// Next.js 需配置保留 rawBody 用于签名校验
// next.config.js:
//   experimental: { serverComponentsExternalPackages: ['crypto'] }
//   + 中间件或 body size 上限配置
```

### 1.5 安全注意事项汇总

| 项目 | 做法 | 理由 |
|---|---|---|
| 签名防篡改 | 签名覆盖 method、pathname、headers、query 全部要素 | 修改任意一项签名即失效 |
| 回调鉴权 | 业务服务器**必须**校验云存储回调签名（x-cos-signature / x-oss-callback） | 否则攻击者直接 POST 伪造成功 |
| 上传大小上限 | 签名策略锁 content-length-range + 业务层双重检查 | 防用户绕前端直接 POST 超大文件 |
| 文件类型白名单 | 签名里锁 Content-Type + 业务服务入库前检查 | 防止 uploadSign 被用于传 shell/病毒 |
| 签名有效期最小化 | 30 分钟，上传完成后即失效 | 防签名 URL 被泄露后滥用 |
| Token 鉴权 | 获取签名前 requireAuth 校验 JWT | 未登录不可触发上传 |
| SQL 注入防护 | 使用 Prisma 参数化查询 | `objectKey` 不拼 SQL |
| 并发安全 | asset 状态 `pending → confirmed` 通过 `findFirst + status:'pending'` 的幂等性保护 | 防重复回调 |

---

## 模块二：生命周期规则配置示例

### 2.1 针对腾讯云 COS 的生命周期规则配置

```xml
<!-- COS Lifecycle config（通过 COS Bucket 控制台 → 基础配置 → 生命周期设置，或 API PUT Bucket lifecycle） -->
<LifecycleConfiguration>
  <!--
    规则 1：所有非置顶资产 — 30 天后转低频
    适用对象：cos://bucket-name/<userId>/*
    例外前缀：cos://bucket-name/pinned/（置顶资产）
  -->
  <Rule>
    <ID>auto-transition-to-standard-ia</ID>
    <Status>Enabled</Status>
    <Filter>
      <!-- 匹配所有对象，但排除 pinned/ 前缀 -->
      <And>
        <Prefix></Prefix>
        <!-- 排除标签 scope=pinned 的对象 -->
        <Tag>
          <Key>scope</Key>
          <Value>pinned</Value>
        </Tag>
      </And>
    </Filter>
    <!-- 注意：COS 的 Filter 中的 Tag 表示"匹配带有此标签的对象"，不是排除。
         实现"排除 pinned"的常见方案有两种：
         (a) 置顶资产加 Tag scope=pinned，生命周期规则不匹配这组（另写一条 skip 规则）
         (b) 置顶资产挪到独立 prefix（如 pinned/）并排除 ———— 推荐方案 (b)
    -->
    <Transition>
      <Days>30</Days>
      <StorageClass>STANDARD_IA</StorageClass>
    </Transition>
    <Expiration>
      <Days>9999</Days>    <!-- 不自动删除，大值模拟永久保留 -->
    </Expiration>
  </Rule>

  <!--
    规则 1 alt（推荐写法：置顶资产走独立 prefix pinned/，规则匹配非 pinned/）
  -->
  <Rule>
    <ID>auto-standard-to-ia-exclude-pinned</ID>
    <Status>Enabled</Status>
    <Filter>
      <And>
        <Prefix></Prefix>
        <!-- COS 生命周期 Filter 支持多条件：同时匹配前缀 + 不含某标签 需要升级写法 -->
      </And>
    </Filter>
    <Transition>
      <Days>30</Days>
      <StorageClass>STANDARD_IA</StorageClass>
    </Transition>
  </Rule>

  <!--
    规则 2：低频层对象 — 创建 120 天后转归档
    （即标准 → 低频 30 天 + 低频停留 90 天 = 共 120 天）
  -->
  <Rule>
    <ID>auto-ia-to-archive</ID>
    <Status>Enabled</Status>
    <Filter>
      <Prefix></Prefix>
    </Filter>
    <Transition>
      <Days>120</Days>
      <StorageClass>ARCHIVE</StorageClass>
    </Transition>
    <Expiration>
      <Days>9999</Days>
    </Expiration>
  </Rule>

  <!--
    规则 3（推荐方案）：置顶资产永不降级
    将用户标记为"收藏/置顶"的资产通过 COS copyObject 移动到 pinned/<userId>/ 前缀下。
    该前缀不匹配任何 Transition 规则。
    注：COS 支持不跨 Bucket 的 copy 重命名（同 Bucket 内 copy + delete 原对象），
        只需 PUT Object Copy 接口，不产生流量费用（同地域）。
  -->
  <Rule>
    <ID>pinned-never-transition</ID>
    <Status>Enabled</Status>
    <Filter>
      <Prefix>pinned/</Prefix>
    </Filter>
    <Expiration>
      <Days>9999</Days>
    </Expiration>
    <!-- 无 Transition 元素 = 永不降级 -->
  </Rule>
</LifecycleConfiguration>
```

**说明**：COS 生命周期是按照对象**创建时间**（非最后访问时间）计算天数。如果"90 天无访问才降低频"是需求的话，需要 COS 智能分层（Intelligent Tiering），它按**访问模式**自动升降。但 COS 智能分层有监控费（¥0.01/万次），单价略高于手动生命周期。本方案折中使用基于创建时间的生命周期（简化运维），低频/归档成本已足够低；如果预算允许且有明确的冷数据二次访问监控场景，可升级智能分层。

### 2.2 针对阿里云 OSS 的生命周期规则配置

```xml
<!-- OSS Lifecycle config（OSS 控制台 → Bucket → 数据管理 → 生命周期，或 API PutBucketLifecycle） -->
<LifecycleConfiguration>
  <!--
    规则 1：非置顶资产 30 天后转低频
    置顶资产走独立 prefix: pinned/，不匹配此规则
  -->
  <Rule>
    <ID>standard-to-ia</ID>
    <Status>Enabled</Status>
    <Prefix></Prefix>                    <!-- 匹配所有根目录对象 -->
    <Transition>
      <Days>30</Days>
      <StorageClass>IA</StorageClass>
    </Transition>
    <Expiration>
      <Days>9999</Days>
    </Expiration>
  </Rule>

  <!-- 规则 2：120 天后低频 → 归档（冷归档） -->
  <Rule>
    <ID>ia-to-cold-archive</ID>
    <Status>Enabled</Status>
    <Prefix></Prefix>
    <Transition>
      <Days>120</Days>
      <StorageClass>ColdArchive</StorageClass>   <!-- OSS 冷归档 ≈ COS 归档 -->
    </Transition>
    <Expiration>
      <Days>9999</Days>
    </Expiration>
  </Rule>

  <!-- 规则 3：pinned/ 前缀 — 无 Transition，永不降级 -->
  <Rule>
    <ID>pinned-forever</ID>
    <Status>Enabled</Status>
    <Prefix>pinned/</Prefix>
    <Expiration>
      <Days>9999</Days>
    </Expiration>
  </Rule>
</LifecycleConfiguration>
```

### 2.3 规则说明（统一口径）

| 阶段 | 触发条件 | 目标层级 | COS | OSS |
|---|---|---|---|---|
| 热 → 温 | 创建满 30 天 | 低频 | STANDARD_IA | IA |
| 温 → 冷 | 创建满 120 天（即低频停 90 天） | 归档 | ARCHIVE | ColdArchive |
| 永久保留 | 所有规则 Days=9999 | 不删除 | Expiration 设置大值 | 同上 |

### 2.4 例外处理：置顶/收藏资产跳过生命周期

**实现思路推荐「prefix 隔离」**（比 tag 更可靠，因为 COS/OSS 生命周期规则对 tag 的"排除"语法各家实现差异很大）：

1. 用户点击「置顶/收藏」时，业务服务器调用 COS/OSS 的 **Copy Object** API，将对象从 `userId/uploads/xxx.mp4` 复制到 `pinned/userId/xxx.mp4`，然后删除旧对象。同地域 copy 不动实体数据（仅改元数据指针），**不产生流量费**。
2. `pinned/` 前缀的资产不在任何 Transition 规则内 → 永久留在标准层。
3. 用户「取消置顶」时，同样 copy 回原路径（`userId/uploads/xxx.mp4`）。

```typescript
// lib/storage/pin-asset.ts
export async function pinAsset(assetId: string, userId: string): Promise<void> {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.userId !== userId) throw new Error('无权操作');

  const newKey = `pinned/${asset.objectKey}`;   // 原 key: <userId>/uploads/uuid.mp4

  // COS Copy Object
  await cosClient.putObjectCopy({
    Bucket: process.env.COS_BUCKET!,
    Region: process.env.COS_REGION!,
    Key: newKey,
    CopySource: `${process.env.COS_BUCKET}.cos.${process.env.COS_REGION}.myqcloud.com/${asset.objectKey}`,
  });
  await cosClient.deleteObject({ Bucket: process.env.COS_BUCKET!, Region: process.env.COS_REGION!, Key: asset.objectKey });

  // 更新数据库
  await prisma.asset.update({
    where: { id: assetId },
    data: { objectKey: newKey, pinned: true, storageClass: 'STANDARD' },
  });

  // CDN 预热新 URL（可选）
  // await cdnPurgeOrPrefetch(newKey);
}
```

### 2.5 归档存储取回注意事项

- **归档取回耗时**：COS ARCHIVE / OSS ColdArchive 恢复需要 **1–5 分钟**（标准取回模式；急用可选加急取回 1–5 分钟 vs 标准 3–5 小时取决于预付费模式）。
- **取回流程**：用户尝试访问归档资产 → CDN miss → COS/OSS 返回 403（归档不可直接 GET） → 业务服务器触发 `POST /api/asset/restore` → 调用 COS POST Object restore → 异步轮询状态 → 恢复完成 → CDN 下次回源命中。
- **成本提示**：归档取回按 GB 计费（¥0.06–0.2/GB）+ 取回后临时标准副本仅保留 N 天。批量取回前应提醒用户。

```typescript
// app/api/asset/restore/route.ts — 触发归档取回
export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  const { assetId } = await req.json();

  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset || asset.userId !== user.id) return NextResponse.json({ error: '无权操作' }, { status: 403 });
  if (asset.storageClass !== 'ARCHIVE' && asset.storageClass !== 'DEEP_ARCHIVE') {
    return NextResponse.json({ error: '当前资产不需要取回' }, { status: 400 });
  }

  await cosClient.restoreObject({
    Bucket: process.env.COS_BUCKET!,
    Region: process.env.COS_REGION!,
    Key: asset.objectKey,
    RestoreRequest: {
      Days: 7,                  // 取回后保留 7 天
      CASJobParameters: {
        Tier: 'Standard',        // Standard / Expedited / Bulk
      },
    },
  });
  await prisma.asset.update({
    where: { id: assetId },
    data: { restoreStatus: 'in_progress', restoreRequestedAt: new Date() },
  });

  return NextResponse.json({ message: '取回已触发，预计 1–5 分钟完成' });
}
```

---

## 模块三：CDN 回源配置

### 3.1 CDN 域名绑定与 CNAME

**步骤**（以腾讯云 CDN / 阿里云 CDN 为例，流程相同）：

1. **添加加速域名**：在 CDN 控制台添加 `cdn.agentcut.com`（或 `assets.agentcut.com`）作为加速域名。
2. **回源配置**：
   - 源站类型：**对象存储（COS/OSS）**
   - 回源地址：`<bucket>.cos.<region>.myqcloud.com`（COS）或 `<bucket>.oss-<region>.aliyuncs.com`（OSS）
   - **回源协议**：HTTPS
   - **开启私有存储回源**（如 Bucket 非公开读）：填写 CDN 回源鉴权密钥或使用 COS/OSS 的 CDN 私有 Bucket 回源授权。
   - **开启回源 Range**：是（支持视频拖拽）。
3. **CNAME 解析**：CDN 提供 CNAME 值（如 `cdn.agentcut.com.cdn.dnsv1.com`），在 DNS 服务添加 CNAME 记录指向该值。
4. **HTTPS 证书**：在 CDN 控制台托管 `cdn.agentcut.com` 的 SSL 证书（自动续期或手动上传）。
5. **等待生效**：配置分发全球边缘节点，一般 5–30 分钟。

### 3.2 回源配置要点

| 配置项 | 值 | 说明 |
|---|---|---|
| 源站类型 | 对象存储（自有源） | — |
| 回源地址 | `<bucket>.cos.<region>.myqcloud.com` | 内网域名（同地域 CDN 回源走内网） |
| 回源协议 | HTTPS | 强制加密 |
| 私有存储授权 | 开启（Bucket 非公开读时） | CDN 用 IAM 角色或密钥回源 |
| 内网回源 | 开启 / 自动 | CDN 与 COS 同地域时默认走内网，免 CDN 回源流量费 |
| Range 回源 | 开启 | 客户端 Range 请求透传到源站 |
| 回源超时 | 30 秒 | 大文件或归档恢复可能慢 |
| 回源重试 | 2 次 | 失败自动换边缘节点重试 |

### 3.3 缓存策略配置

```yaml
# CDN 缓存规则（腾讯云 CDN / 阿里云 CDN 配置面板等效）

缓存规则:
  # 图片资源
  - path: "*.jpg;*.jpeg;*.png;*.gif;*.webp;*.svg;*.bmp"
    cacheTTL: 604800           # 7 天
    cacheMode: standard

  # 音频资源
  - path: "*.mp3;*.wav;*.ogg;*.flac;*.aac;*.m4a"
    cacheTTL: 604800           # 7 天
    cacheMode: standard

  # 视频资源
  - path: "*.mp4;*.webm;*.mov;*.avi"
    cacheTTL: 86400            # 1 天
    cacheMode: standard
    # 视频内容变化频率低于图片（通常生成后不改），1 天平衡命中率与更新

  # 动态/头像（用户可能频繁更换）
  - path: "*/avatars/*"
    cacheTTL: 0                # 不缓存
    cacheMode: bypass

  # 默认规则
  - path: "*"
    cacheTTL: 86400            # 1 天兜底
```

**缓存键规则**：只以 `URL Path` 为缓存键（`?v=...` 参数忽略），避免 query string 抖动导致 miss。

### 3.4 Range 回源配置

确保 CDN 节点透传客户端的 `Range: bytes=<start>-<end>` 请求头到源站，典型场景：

1. 用户拖拽视频进度条至 60 秒位置 → 浏览器发 `Range: bytes=60000000-`。
2. CDN 收到后直接回源请求 COS/OSS → COS/OSS 返回 206 Partial Content。
3. CDN 缓存该 Range 片段（视频分片缓存），后续相同 Range 请求直接边缘命中。

**验证**：`curl -I -H "Range: bytes=0-1023" https://cdn.agentcut.com/userId/uploads/vid.mp4` 应返回 `206 Partial Content` 与 `Content-Range`。

**配置要点**：
- CDN 控制台 → 回源配置 → 开启「Range 回源」。
- 如果 CDN 开启了「分片回源」，可进一步拆分大文件为多块回源，提升命中率。
- 视频建议开启「智能压缩」（gzip/brotli 对视频无效但对 playlist 有效，建议对 `*.m3u8` 开启）。

### 3.5 刷新预热策略

| 操作 | 触发条件 | 实现 |
|---|---|---|
| 目录刷新 | 用户置顶/取消置顶资产、新上传（CDN miss 自动回源通常不需要主动刷新） | `POST /2018-08-08/cdn/Refresh` |
| URL 预热 | 用户置顶资产立即生效；批量新生成成片提前推至边缘 | `POST /2018-08-08/cdn/Prefetch` |
| 定时清理 | 过期/删除资产物理删除后 | 调用 Purge URL 或 Purge Path（按目录前缀） |

```typescript
// lib/cdn/purge.ts
export async function purgeCdnUrls(urls: string[]): Promise<void> {
  const cdn = new CDNClient({
    secretId: process.env.CDN_SECRET_ID!,
    secretKey: process.env.CDN_SECRET_KEY!,
  });
  await cdn.PurgeUrlsCache({ Urls: urls });   // 单次最多 1000 条
}

export async function prefetchCdnUrls(urls: string[]): Promise<void> {
  const cdn = new CDNClient({
    secretId: process.env.CDN_SECRET_ID!,
    secretKey: process.env.CDN_SECRET_KEY!,
  });
  await cdn.PushUrlsCache({ Urls: urls });     // 单次最多 1000 条（每日限额）
}
```

---

## 模块四：rclone 增量同步脚本（云存储 → 自建 NAS/MinIO）

### 4.1 rclone 安装与配置

```bash
# ------------ 安装 ------------
# macOS
brew install rclone

# Linux
curl https://rclone.org/install.sh | sudo bash

# ------------ 配置 ------------
# rclone config 交互式向导，或直接写配置文件
mkdir -p ~/.config/rclone
cat > ~/.config/rclone/rclone.conf << 'EOF'

# ===== 云存储 remote（以 COS 为例）=====
[cos-agentcut]
type = s3
provider = TencentCOS
env_auth = false
access_key_id = AKIDxxxxxxxxxxxxxxxx
secret_access_key = xxxxxxxxxxxxxxxxxxxxxxxx
endpoint = cos.ap-guangzhou.myqcloud.com
acl = private
# 仅同步标准层 + 低频层文件（排除归档，减少回源成本）
# 可通过 --exclude 在命令中过滤

# ===== 阿里云 OSS remote（备选）=====
[oss-agentcut]
type = s3
provider = Alibaba
env_auth = false
access_key_id = LTAIxxxxxxxxxxxxxxxx
secret_access_key = xxxxxxxxxxxxxxxxxxxxxxxx
endpoint = oss-cn-hangzhou.aliyuncs.com
acl = private

# ===== 自建 MinIO / NAS remote =====
[nas-minio]
type = s3
provider = Minio
env_auth = false
access_key_id = minioadmin
secret_access_key = minioadmin123
endpoint = http://192.168.1.100:9000   # 内网 IP
acl = private

# ===== NAS 本地路径（NFS / SMB 挂载）=====
[nas-local]
type = local

EOF

chmod 600 ~/.config/rclone/rclone.conf
```

### 4.2 每周增量同步脚本

```bash
#!/usr/bin/env bash
# ============================================================
# rclone_weekly_sync.sh
# 用途：每周增量同步 COS → 自建 NAS/MinIO
# 建议 crontab: 0 2 * * 0  /opt/scripts/rclone_weekly_sync.sh >> /var/log/rclone_sync.log 2>&1
#              （每周日凌晨 2:00，避开业务高峰）
# ============================================================

set -euo pipefail

# ---------- 配置 ----------
SRC_REMOTE="cos-agentcut:"                   # 云存储 remote + bucket（已在 config 中包含 bucket）
DST_REMOTE="nas-minio:agentcut-backup"       # 目标 MinIO bucket
LOG_DIR="/var/log/rclone"
LOCK_FILE="/tmp/rclone_sync.lock"
NOTIFY_HOOK="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_WEBHOOK_KEY"  # 企业微信

mkdir -p "$LOG_DIR"

# ---------- 防并发 ----------
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "[$(date)] 上一轮同步未完成，跳过"; exit 0; }

# ---------- 通知函数 ----------
send_notify() {
  local subject="$1"
  local body="$2"
  if [ -n "$NOTIFY_HOOK" ]; then
    curl -s -X POST "$NOTIFY_HOOK" \
      -H 'Content-Type: application/json' \
      -d "{\"msgtype\":\"markdown\",\"markdown\":{\"content\":\"## ${subject}\n${body}\"}}" \
      > /dev/null
  fi
}

# ---------- 执行同步 ----------
echo "[$(date)] ===== 开始周增量同步 ====="

rclone sync "$SRC_REMOTE" "$DST_REMOTE" \
  --progress \
  --log-file="${LOG_DIR}/sync_$(date +%Y%m%d).log" \
  --log-level INFO \
  --transfers 16 \              # 16 并发
  --checkers 32 \               # 32 并发校验
  --fast-list \                 # 加速列表
  --update \                    # 只同步源更新时间更新的
  --use-server-modtime \        # 用服务端时间
  --size-only \                 # 仅比较文件大小（加速增量判断）
  --max-delete 0 \              # 安全策略：从不删除 NAS 侧文件
  --exclude "/pinned/**" \      # 排除置顶资产（可选：置顶资产本就重要，不备份也可从云恢复）
  --exclude "*/.trash/**" \     # 排除回收站
  --exclude "*.tmp" \           # 排除临时文件
  --retries 3 \
  --low-level-retries 10 \
  --timeout 30m \
  || {
    echo "[$(date)] 同步失败"
    send_notify "❌ rclone 同步失败" "详见日志: ${LOG_DIR}/sync_$(date +%Y%m%d).log"
    exit 1
  }

echo "[$(date)] 同步完成"
send_notify "✅ rclone 周同步完成" \
  "源：${SRC_REMOTE}\n目标：${DST_REMOTE}\n时间：$(date '+%Y-%m-%d %H:%M:%S')\n日志：${LOG_DIR}/sync_$(date +%Y%m%d).log"

# ---------- 清理 30 天前日志 ----------
find "$LOG_DIR" -name "sync_*.log" -mtime +30 -delete
```

**首次全量同步注意事项**：

- 首次不用 `--update`，直接跑全量，预计时间很长（取决于总量）；建议在非业务期（周六凌晨）跑，且提前 `rclone size cos-agentcut:` 估算数据量。
- 首次完成后**不要**加 `--delete` 或 `--max-delete`，避免误删现有备份。

### 4.3 同步状态监控脚本

```bash
#!/usr/bin/env bash
# ============================================================
# rclone_check.sh
# 用途：每日检查上次同步是否在 8 天内完成 + NAS 磁盘空间
# crontab: 0 9 * * * /opt/scripts/rclone_check.sh
# ============================================================

set -euo pipefail

LATEST_LOG=$(ls -1t /var/log/rclone/sync_*.log | head -1)
NOTIFY_HOOK="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_WEBHOOK_KEY"

# 1. 检查同步新鲜度
LAST_SYNC_TS=$(stat -f %m "$LATEST_LOG" 2>/dev/null || stat -c %Y "$LATEST_LOG")
NOW=$(date +%s)
DIFF_DAYS=$(( (NOW - LAST_SYNC_TS) / 86400 ))

if [ "$DIFF_DAYS" -gt 8 ]; then
  curl -s -X POST "$NOTIFY_HOOK" \
    -H 'Content-Type: application/json' \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"⚠️ rclone 上次同步已在 ${DIFF_DAYS} 天前，请检查！\"}}"
fi

# 2. 检查 NAS 磁盘使用率
NAS_USAGE=$(df /mnt/nas | tail -1 | awk '{print $5}' | sed 's/%//')
if [ "$NAS_USAGE" -gt 85 ]; then
  curl -s -X POST "$NOTIFY_HOOK" \
    -H 'Content-Type: application/json' \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"🚨 NAS 磁盘使用率 ${NAS_USAGE}% 超过 85% 预警线，请扩容或清理！\"}}"
fi

echo "[$(date)] check OK (${DIFF_DAYS}d since last sync, NAS ${NAS_USAGE}%)"
```

### 4.4 rclone sync vs copy 策略说明

| 命令 | 行为 | 适用场景 |
|---|---|---|
| `rclone sync src dst` | 使 dst 与 src 完全一致（会删除 dst 多出的文件） | 配合 `--max-delete 0` 使用 |
| `rclone copy src dst` | 只新增/更新，不删除 | 纯增量累积，适合首次 + 持续 |
| `rclone check src dst` | 仅校验差异（dry run） | 验证一致性不传输 |

**本方案推荐 `rclone copy`（而非 sync）用于日常增量**——数据只增不删，NAS 侧永远保留完整历史（直到手动清理或存储满）。如果需要严格镜像，改用 `rclone sync --max-delete <limit>`，并在删除前报告差异列表。

### 4.5 灾难恢复流程

```
场景 A：自建 NAS / MinIO 故障
─────────────────────────────
1. NAS 硬件/磁盘故障 → 本备份不可用
2. 评估是否需要立即恢复备份（如果云存储正常则不急）
3. 准备新 NAS / 重装 MinIO → rclone 全量重新同步（rclone copy cos-agentcut: nas-minio:backup --fast-list）
4. 首次全量耗时取决于总量（TB 级可数月），期间依赖云存储本身作为唯一副本
5. 恢复完成后运行 rclone check 验证一致性

场景 B：云对象存储故障（COS/OSS 不可用）
─────────────────────────────────────────
1. CDN 节点可能仍缓存部分热数据（短期可扛）
2. 确认故障范围（单个 Bucket? 地域级?）
3. 如果 Bucket 不恢复、需要靠 NAS 恢复数据：
   a. 启动临时云服务实例（或使用 MinIO 对外 S3 接口）
   b. 将 NAS 挂载到业务服务器可访问的网络
   c. 修改后端 STORAGE_PROVIDER 指向 MinIO 的 endpoint
   d. CDN 回源改为 MinIO endpoint（或直接以 MinIO URL 提供下载）
4. 云存储恢复后：rclone sync nas-minio: cos-agentcut: --max-delete 0
   反向同步回 COS（注意 rclone 支持双向，但建议人工确认后再推）

场景 C：数据被误删 / 勒索病毒
─────────────────────────────
1. 在 COS 开启版本控制（Versioning）是最好的第一道防线
2. 其次本地 rclone 备份保留了 WAS（Write-After-Sync）快照
3. 从 NAS 历史中找到最近一次同步的干净版本，rclone copy 回 COS
```

---

## 附录：环境变量汇总

```bash
# ===== 存储提供商 =====
STORAGE_PROVIDER=cos                     # cos | oss | qiniu | r2

# ===== COS =====
COS_BUCKET=agentcut-assets-1234567890
COS_REGION=ap-guangzhou
COS_SECRET_ID=AKIDxxxxxxxxxxxxxxxx
COS_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxx

# ===== OSS =====
OSS_BUCKET=agentcut-assets
OSS_REGION=cn-hangzhou
OSS_ACCESS_KEY_ID=LTAIxxxxxxxxxxxxxxxx
OSS_ACCESS_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx

# ===== CDN =====
CDN_DOMAIN=https://cdn.agentcut.com
CDN_SECRET_ID=AKIDxxxxxxxxxxxxxxxx
CDN_SECRET_KEY=xxxxxxxxxxxxxxxxxxxxxxxx

# ===== rclone backup =====
BACKUP_NAS_ENDPOINT=http://192.168.1.100:9000
BACKUP_NAS_ACCESS_KEY=minioadmin
BACKUP_NAS_SECRET_KEY=xxxxxxxxxxxxxxxx
```

---

> **文档版本**：v1.0 / 2026-07-26
> **关联文档**：AgentCut产品文档.md（PRD 第八/九章：存储架构）
