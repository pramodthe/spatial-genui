"""TRELLIS.2 image-to-3D on a Modal GPU (tier D of docs/3d-architecture.md), part of the v2 experiment.

Deploy:  modal deploy modal_trellis.py      (needs the Modal secret "genui-hf-v2" with HF_TOKEN; the
         Hugging Face account must have access to facebook/dinov3-vitl16-pretrain-lvd1689m)
Call:    modal.Cls.from_name("spatial-genui-3d-v2", "Trellis")().image_to_glb.remote(image_bytes)
         from the device's Modal login (see fetch_trellis_modal.py). No web endpoint, no extra token.

Environment and settings follow Microsoft's own TRELLIS.2 demo (pinned revisions below), including its
prebuilt CUDA extensions, which are compiled for RTX PRO 6000 (sm_120); hence that GPU. Background
removal uses BiRefNet (MIT) instead of the demo's BRIA RMBG-2.0, which is gated and non-commercial.
Weights are cached in the experiment's Modal volume, so only the first call downloads them.
"""

import modal

SPACE_REVISION = "ebf60b20fc5a4607f90a1c11c0aab0ceeda5429d"  # huggingface.co/spaces/microsoft/TRELLIS.2
MODEL_REVISION = "af44b45f2e35a493886929c6d786e563ec68364d"  # huggingface.co/microsoft/TRELLIS.2-4B
WHEELS = "https://github.com/LDYang694/Storages/releases/download/rtxpro6000"

image = (
    # Debian 13: the demo's prebuilt extensions need a newer C++ runtime (CXXABI_1.3.15) than Debian 12 has.
    modal.Image.from_registry("python:3.12-slim-trixie")
    .apt_install("git", "libgl1", "libglib2.0-0t64", "libgomp1")
    .pip_install("torch==2.11.0", "torchvision==0.26.0", "triton==3.6.0", extra_index_url="https://download.pytorch.org/whl/cu130")
    .pip_install(
        "pillow==12.0.0", "imageio==2.37.2", "imageio-ffmpeg==0.6.0", "tqdm==4.67.1", "easydict==1.13",
        "opencv-python-headless==4.12.0.88", "trimesh==4.10.1", "transformers==4.57.3", "zstandard==0.25.0",
        "kornia==0.8.2", "timm==1.0.22", "huggingface_hub",
        "git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8",
        "https://github.com/adithyaxx/flash-attention/releases/download/v2.8.3/flash_attn-2.8.3+cu13torch2.11cxx11abiTRUE-cp312-cp312-linux_x86_64.whl",
        f"{WHEELS}/flex_gemm-1.0.0%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
        f"{WHEELS}/nvdiffrast-0.4.0%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
        f"{WHEELS}/nvdiffrec_render-0.0.0%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
        f"{WHEELS}/cumesh-0.0.1%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
        f"{WHEELS}/o_voxel-0.0.1%2Btorch2.11.0.cu130-cp312-cp312-linux_x86_64.whl",
    )
    # The trellis2 package and the demo's GEMM autotune cache, at a pinned revision (no example images).
    .run_commands(
        f"hf download microsoft/TRELLIS.2 --repo-type space --revision {SPACE_REVISION} --local-dir /opt/trellis "
        "--exclude 'assets/*' 'app.py'"
    )
    .env({
        "PYTHONPATH": "/opt/trellis",
        "ATTN_BACKEND": "flash_attn",
        "PYTORCH_CUDA_ALLOC_CONF": "expandable_segments:True",
        "FLEX_GEMM_AUTOTUNE_CACHE_PATH": "/opt/trellis/autotune_cache.json",
        "OPENCV_IO_ENABLE_OPENEXR": "1",
        "HF_HOME": "/cache/hf",
    })
    # Triton compiles small C launcher stubs at runtime. Last layer, so adding it rebuilt nothing above.
    .apt_install("build-essential")
)

app = modal.App("spatial-genui-3d-v2")
volume = modal.Volume.from_name("genui-assets-v2", create_if_missing=True)


@app.function(image=image, gpu="RTX-PRO-6000", timeout=600)
def gpu_check() -> str:
    """Smoke test: the prebuilt CUDA extensions load and run on this GPU (no model download).
    Errors come back as text: torch's exception types can't be unpickled on a machine without torch."""
    import json
    import traceback

    try:
        import cumesh, flash_attn, flex_gemm, nvdiffrast.torch, o_voxel  # noqa: F401
        import torch
        import trellis2.pipelines  # noqa: F401

        x = torch.randn(1024, 1024, device="cuda")
        result = {"torch": str(torch.__version__), "device": torch.cuda.get_device_name(0),
                  "capability": list(torch.cuda.get_device_capability(0)), "matmul_ok": bool((x @ x).isfinite().all())}
    except Exception:
        result = {"error": traceback.format_exc()[-2000:]}
    print(result)
    return json.dumps(result)  # plain text: the caller needs no torch to read it


@app.cls(
    image=image, gpu="RTX-PRO-6000", volumes={"/cache": volume}, secrets=[modal.Secret.from_name("genui-hf-v2")],
    timeout=1800, scaledown_window=120,  # the first call downloads ~15 GB of weights into the volume
)
class Trellis:
    @modal.enter()
    def load(self) -> None:
        from huggingface_hub import snapshot_download

        import trellis2.pipelines.rembg as rembg
        from trellis2.pipelines import Trellis2ImageTo3DPipeline

        # pipeline.json asks for BRIA RMBG-2.0 (gated, non-commercial); BiRefNet is the same class, MIT weights.
        birefnet = rembg.BiRefNet
        rembg.BiRefNet = lambda **_: birefnet(model_name="ZhengPeng7/BiRefNet")
        path = snapshot_download("microsoft/TRELLIS.2-4B", revision=MODEL_REVISION)
        self.pipeline = Trellis2ImageTo3DPipeline.from_pretrained(path)
        self.pipeline.low_vram = False
        self.pipeline.cuda()
        volume.commit()  # keep downloaded weights for the next container

    @modal.method()
    def image_to_glb(self, image_bytes: bytes, seed: int = 0, resolution: str = "1024",
                     decimation_target: int = 100_000, texture_size: int = 1024) -> dict:
        """One image in, one textured GLB out, with the demo's default sampler settings."""
        import io
        import tempfile
        import time

        import o_voxel
        import torch
        from PIL import Image

        started = time.time()
        image = Image.open(io.BytesIO(image_bytes))
        outputs, latents = self.pipeline.run(
            image, seed=seed, preprocess_image=True, return_latent=True,
            pipeline_type={"512": "512", "1024": "1024_cascade", "1536": "1536_cascade"}[resolution],
        )
        generated = time.time()
        _, _, grid = latents
        mesh = outputs[0]
        mesh.simplify(16777216)  # nvdiffrast limit, as in the demo
        glb = o_voxel.postprocess.to_glb(
            vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
            attr_layout=self.pipeline.pbr_attr_layout, grid_size=grid, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
            decimation_target=decimation_target, texture_size=texture_size,
            remesh=True, remesh_band=1, remesh_project=0,
        )
        with tempfile.NamedTemporaryFile(suffix=".glb") as f:
            glb.export(f.name, extension_webp=True)
            data = open(f.name, "rb").read()
        torch.cuda.empty_cache()
        return {
            "glb": data,
            "generate_s": round(generated - started, 1),
            "export_s": round(time.time() - generated, 1),
            "settings": {"seed": seed, "resolution": resolution, "decimation_target": decimation_target, "texture_size": texture_size},
        }
