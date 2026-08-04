"""
MiniMax H3 Reference-to-Video workflow template for ComfyUI.

Node IDs:
  5:  PrimitiveStringMultiline (prompt text → injected by AgentCut)
  6:  PrimitiveFloat (video duration in seconds)
  7:  ComfyMathExpression (frame count calculation)
  100-108: LoadImage nodes for reference images (injected by AgentCut)

Connections reference the output indices of each node.
"""

MINIMAX_H3_REF2VIDEO_WORKFLOW = {
    "1": {
        "class_type": "UNETLoader",
        "inputs": {
            "unet_name": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
            "weight_dtype": "default",
        },
    },
    "2": {
        "class_type": "CLIPLoader",
        "inputs": {
            "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
            "type": "minimax",
            "device": "default",
        },
    },
    "3": {
        "class_type": "VAELoader",
        "inputs": {"vae_name": "minimax_h3_video_vae_fp16.safetensors"},
    },
    "4": {
        "class_type": "VAELoader",
        "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"},
    },
    "5": {
        "class_type": "PrimitiveStringMultiline",
        "inputs": {"value": "PROMPT_INJECTED_BY_AGENTCUT"},
    },
    "6": {
        "class_type": "PrimitiveFloat",
        "inputs": {"value": 5.0},
    },
    "7": {
        "class_type": "ComfyMathExpression",
        "inputs": {
            "expression": "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17",
            "values.a": ["6", 0],
        },
    },
    "8": {
        "class_type": "ResolutionSelector",
        "inputs": {
            "aspect_ratio": "16:9 (Widescreen)",
            "megapixels": 0.9,
            "multiple": 32,
        },
    },
    "9": {
        "class_type": "MiniMaxH3ReferenceToVideo",
        "inputs": {
            "prompt": ["5", 0],
            "width": ["8", 0],
            "height": ["8", 1],
            "length": ["7", 1],
            "ref_image_size": "match",
            "clip": ["2", 0],
            "vae": ["3", 0],
            "audio_vae": ["4", 0],
            "ref_images.ref_image.0": ["100", 0],
            "ref_images.ref_image.1": ["101", 0],
            "ref_images.ref_image.2": ["102", 0],
            "ref_images.ref_image.3": ["103", 0],
            "ref_images.ref_image.4": ["104", 0],
            "ref_images.ref_image.5": ["105", 0],
            "ref_images.ref_image.6": ["106", 0],
            "ref_images.ref_image.7": ["107", 0],
            "ref_images.ref_image.8": ["108", 0],
        },
    },
    "10": {
        "class_type": "BasicGuider",
        "inputs": {
            "model": ["1", 0],
            "conditioning": ["9", 0],
        },
    },
    "11": {
        "class_type": "BasicScheduler",
        "inputs": {
            "scheduler": "simple",
            "steps": 20,
            "denoise": 1.0,
            "model": ["1", 0],
        },
    },
    "12": {
        "class_type": "KSamplerSelect",
        "inputs": {"sampler_name": "res_multistep"},
    },
    "13": {
        "class_type": "RandomNoise",
        "inputs": {"noise_seed": 0},
    },
    "14": {
        "class_type": "SamplerCustomAdvanced",
        "inputs": {
            "noise": ["13", 0],
            "guider": ["10", 0],
            "sampler": ["12", 0],
            "sigmas": ["11", 0],
            "latent_image": ["9", 1],
        },
    },
    "15": {
        "class_type": "VAEDecode",
        "inputs": {
            "samples": ["14", 0],
            "vae": ["3", 0],
        },
    },
    "16": {
        "class_type": "VAEDecodeAudio",
        "inputs": {
            "samples": ["14", 0],
            "vae": ["4", 0],
        },
    },
    "17": {
        "class_type": "CreateVideo",
        "inputs": {
            "fps": 24.0,
            "bit_depth": 8,
            "images": ["15", 0],
            "audio": ["16", 0],
        },
    },
    "18": {
        "class_type": "SaveVideo",
        "inputs": {
            "filename_prefix": "video/minimax-h3/AgentCut",
            "format": "mp4",
            "codec": "h264",
            "video": ["17", 0],
        },
    },
    # Reference image placeholders (AgentCut injects images here)
    "100": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref0.png"},
    },
    "101": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref1.png"},
    },
    "102": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref2.png"},
    },
    "103": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref3.png"},
    },
    "104": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref4.png"},
    },
    "105": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref5.png"},
    },
    "106": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref6.png"},
    },
    "107": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref7.png"},
    },
    "108": {
        "class_type": "LoadImage",
        "inputs": {"image": "placeholder_ref8.png"},
    },
}
