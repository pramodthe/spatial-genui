"""P3-SAM 3D part segmentation on a Modal GPU (M5 of docs/3d-architecture.md), part of the v2 experiment.

Deploy:  modal deploy modal_parts.py   (Modal secret "genui-hf-v2" with HF_TOKEN)
Call:    modal.Cls.from_name("spatial-genui-3d-v2-parts", "P3SAM")().segment.remote(ply_bytes)
         from the device's Modal login (see library/segment.py). Returns {"faceIds": [part per face], ...}
         for the mesh as sent: no cleaning, so face k of the reply is face k of the input.

P3-SAM (Tencent Hunyuan3D-Part, 2025) segments any mesh into parts without prompts. Licences: the
code and P3-SAM weights are under the Tencent Hunyuan 3D-Part Community License (not valid in the EU,
UK or South Korea); P3-SAM is built on Meta's Sonata, whose weights are CC BY-NC 4.0. So: research,
education and the competition only, not commercial use. Its own app, so deploying it never touches the
TRELLIS or retrieval apps; it scales to zero when idle. Weights are cached in the experiment's volume.
"""

import modal

REPO_REVISION = "e96be065375438962375b55326416291342958a7"  # github.com/Tencent-Hunyuan/Hunyuan3D-Part, 2025-12-05

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install("torch==2.4.0", "torchvision==0.19.0", index_url="https://download.pytorch.org/whl/cu124")
    .pip_install(
        "spconv-cu124==2.3.8", "timm==1.0.22", "addict==2.4.0", "omegaconf==2.3.0", "huggingface_hub", "safetensors",
        "scipy==1.15.3", "scikit-learn==1.7.2", "fpsample==0.3.3", "numba==0.62.1", "trimesh==4.10.1", "tqdm", "packaging",
        "numpy==2.1.2",
        "https://data.pyg.org/whl/torch-2.4.0%2Bcu124/torch_scatter-2.1.2%2Bpt24cu124-cp310-cp310-linux_x86_64.whl",
        "https://github.com/Dao-AILab/flash-attention/releases/download/v2.6.3/flash_attn-2.6.3+cu123torch2.4cxx11abiFALSE-cp310-cp310-linux_x86_64.whl",
    )
    .run_commands(
        "git clone https://github.com/Tencent-Hunyuan/Hunyuan3D-Part /opt/hy3dpart "
        f"&& cd /opt/hy3dpart && git checkout {REPO_REVISION} && rm -rf P3-SAM/demo/assets P3-SAM/images XPart/assets"
    )
    .env({"HF_HOME": "/cache/hf", "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True"})
)

app = modal.App("spatial-genui-3d-v2-parts")
volume = modal.Volume.from_name("genui-assets-v2", create_if_missing=True)


@app.cls(
    image=image, gpu=["L40S", "A10G", "L4"], volumes={"/cache": volume}, secrets=[modal.Secret.from_name("genui-hf-v2")],
    timeout=1200, scaledown_window=60,
)
class P3SAM:
    @modal.enter()
    def load(self) -> None:
        import os
        import sys

        from huggingface_hub import hf_hub_download

        # Sonata's weights are fetched into /root/sonata (hard-coded upstream): keep them in the volume.
        os.makedirs("/cache/sonata", exist_ok=True)
        if not os.path.exists("/root/sonata"):
            os.symlink("/cache/sonata", "/root/sonata")
        sys.path[:0] = ["/opt/hy3dpart/P3-SAM", "/opt/hy3dpart/P3-SAM/demo"]
        from auto_mask import AutoMask

        ckpt = hf_hub_download("tencent/Hunyuan3D-Part", "p3sam/p3sam.safetensors")
        self.auto = AutoMask(ckpt)
        volume.commit()  # keep downloaded weights for the next container

    @modal.method()
    def segment(self, ply: bytes, post_process: bool = True, seed: int = 42) -> dict:
        import io
        import random
        import tempfile
        import time

        import numpy as np
        import torch
        import trimesh

        mesh = trimesh.load(io.BytesIO(ply), file_type="ply", process=False)
        random.seed(seed)
        np.random.seed(seed)
        torch.manual_seed(seed)
        started = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            aabb, face_ids, out = self.auto.predict_aabb(
                mesh, save_path=tmp, post_process=post_process, save_mid_res=False, show_info=False,
                clean_mesh_flag=False, seed=seed, is_parallel=False,
                prompt_bs=8)  # upstream's 32 needs more than a 24 GB GPU at 100k points
        # Plain lists: the caller needs no torch or numpy pickles to read the result.
        return {"faceIds": np.asarray(face_ids).astype(int).tolist(), "faces": int(len(out.faces)),
                "aabb": np.asarray(aabb).tolist(), "seconds": round(time.time() - started, 1)}
