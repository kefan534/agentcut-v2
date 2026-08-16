import { Bot, Clapperboard } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { App, Button, Form, Input, InputNumber, Select, Spin, Tabs, Tag } from "antd";

import {
    adminGetAgentConfig,
    adminUpdateAgentConfig,
    adminListVariables,
    getBackendErrorMessage,
    type AgentConfigScope,
} from "@/services/api/backend";

// 内置工具名（与后端 BUILTIN_TOOLS / 短剧编剧工具保持一致）
const TOOL_OPTIONS: Record<string, { label: string; tools: { value: string; label: string }[] }> = {
    global: {
        label: "通用 Agent",
        tools: [
            { value: "get_user_credits", label: "查询用户积分" },
            { value: "asset_list", label: "检索素材列表" },
            { value: "asset_get_text", label: "读取素材文本" },
            { value: "ima_search", label: "ima 知识库搜索" },
            { value: "skill_list", label: "查看已启用技能" },
        ],
    },
    script_agent: {
        label: "短剧工坊智能体",
        tools: [
            { value: "list_novels", label: "列出小说章节" },
            { value: "get_novel_text", label: "读取章节原文" },
            { value: "list_scripts", label: "列出剧本" },
            { value: "get_script_content", label: "读取剧本内容" },
            { value: "save_script", label: "保存剧本" },
        ],
    },
};

function ScopeForm({ scope }: { scope: string }) {
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [textVariables, setTextVariables] = useState<string[]>([]);
    const meta = TOOL_OPTIONS[scope];

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [data, vars] = await Promise.all([adminGetAgentConfig(), adminListVariables()]);
            // 下拉选项来自「变量映射」里 text 类的变量名
            setTextVariables(vars.filter((v) => v.modal_category === "text").map((v) => v.variable_name));
            const cfg = data.scopes[scope];
            if (cfg) {
                form.setFieldsValue({
                    system_prompt: cfg.system_prompt ?? "",
                    model_variable: cfg.model_variable ?? undefined,
                    enabled_tools: cfg.enabled_tools ?? meta.tools.map((t) => t.value),
                    max_steps: cfg.max_steps ?? 16,
                    tool_timeout_sec: cfg.tool_timeout_sec ?? 30,
                });
            }
        } catch (e) {
            message.error(getBackendErrorMessage(e, "加载配置失败"));
        } finally {
            setLoading(false);
        }
    }, [form, message, scope, meta.tools]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleSave = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            await adminUpdateAgentConfig(scope, {
                system_prompt: values.system_prompt,
                model_variable: values.model_variable || null,
                enabled_tools: values.enabled_tools,
                max_steps: values.max_steps,
                tool_timeout_sec: values.tool_timeout_sec,
            });
            message.success("配置已保存，立即生效");
        } catch (e) {
            message.error(getBackendErrorMessage(e, "保存失败"));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex h-64 items-center justify-center"><Spin /></div>;
    }

    return (
        <Form form={form} layout="vertical" className="max-w-3xl">
            <Form.Item
                name="system_prompt"
                label="系统提示词（System Prompt）"
                tooltip="Agent 的人格与行为约束，留空则回退到默认值"
            >
                <Input.TextArea rows={6} placeholder="定义 Agent 的角色、能力与回答风格…" />
            </Form.Item>

            <Form.Item
                name="model_variable"
                label="文本模型（变量名）"
                tooltip="从「变量映射」中 text 类的变量名里选择；留空则使用默认文本模型"
            >
                <Select
                    allowClear
                    placeholder="留空 = 默认文本模型"
                    options={textVariables.map((v) => ({ value: v, label: v }))}
                />
            </Form.Item>

            <Form.Item name="enabled_tools" label="启用的工具" tooltip="勾选 Agent 可调用的工具">
                <Select mode="multiple" options={meta.tools} placeholder="选择启用的工具" />
            </Form.Item>

            <div className="grid grid-cols-2 gap-4">
                <Form.Item name="max_steps" label="最大工具调用步数" tooltip="防止死循环">
                    <InputNumber min={1} max={64} className="w-full" />
                </Form.Item>
                <Form.Item name="tool_timeout_sec" label="单工具超时（秒）">
                    <InputNumber min={5} max={300} className="w-full" />
                </Form.Item>
            </div>

            <Button type="primary" loading={saving} onClick={handleSave}>
                保存配置
            </Button>
        </Form>
    );
}

export function AdminAgentConfig() {
    return (
        <div>
            <div className="mb-4 flex items-center gap-2">
                <Bot className="size-5 text-stone-600 dark:text-stone-300" />
                <h2 className="text-base font-medium text-stone-900 dark:text-stone-100">Agent 配置</h2>
                <Tag>重启不丢失 · 保存即时生效</Tag>
            </div>
            <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">
                在这里配置全站通用 Agent 与短剧工坊智能体的提示词、模型、工具与参数，无需改代码重新部署。
            </p>
            <Tabs
                defaultActiveKey="global"
                items={[
                    { key: "global", label: "通用 Agent", children: <ScopeForm scope="global" /> },
                    { key: "script_agent", label: "短剧工坊智能体", children: <ScopeForm scope="script_agent" /> },
                ]}
            />
        </div>
    );
}
