"""DINOv3 image embeddings for retrieval (tier C of docs/3d-architecture.md, section 4.3), part of the
v2 experiment.

Deploy:  modal deploy modal_retrieval.py   (needs the Modal secret "genui-hf-v2" with HF_TOKEN; the
         Hugging Face account must have access to facebook/dinov3-vitl16-pretrain-lvd1689m, the same
         weights TRELLIS.2 uses, so they are usually already cached in the experiment's volume)
Call:    modal.Cls.from_name("spatial-genui-3d-v2-retrieval", "Dino")().embed.remote([image bytes, ...])
         from the device's Modal login, like fetch_trellis.py.

Returns one unit-length vector per image (the class token, 1024 floats), so cosine similarity is a
dot product. Its own app, so deploying it never touches the TRELLIS app; it scales to zero when idle.
"""

import modal

MODEL = "facebook/dinov3-vitl16-pretrain-lvd1689m"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.8.0", "torchvision==0.23.0", "transformers==4.57.3", "pillow==12.0.0", "huggingface_hub")
    .env({"HF_HOME": "/cache/hf"})
)

app = modal.App("spatial-genui-3d-v2-retrieval")
volume = modal.Volume.from_name("genui-assets-v2", create_if_missing=True)


@app.cls(
    # Any of these runs a ViT-L in milliseconds; a list lets Modal use whichever has capacity.
    image=image, gpu=["L4", "A10G", "T4", "L40S"], volumes={"/cache": volume}, secrets=[modal.Secret.from_name("genui-hf-v2")],
    timeout=600, scaledown_window=60,
)
class Dino:
    @modal.enter()
    def load(self) -> None:
        import torch
        from transformers import AutoImageProcessor, AutoModel

        self.processor = AutoImageProcessor.from_pretrained(MODEL)
        # Full precision: the ViT-L's activations overflow float16 (every similarity came out NaN).
        self.model = AutoModel.from_pretrained(MODEL, torch_dtype=torch.float32).cuda().eval()
        volume.commit()  # keep downloaded weights for the next container

    @modal.method()
    def embed(self, images: list[bytes]) -> list[list[float]]:
        import io

        import torch
        from PIL import Image

        pictures = []
        for data in images:
            picture = Image.open(io.BytesIO(data))
            if picture.mode in ("RGBA", "LA", "P"):  # transparent renders: put them on white, like photos
                picture = picture.convert("RGBA")
                white = Image.new("RGBA", picture.size, (255, 255, 255, 255))
                white.alpha_composite(picture)
                picture = white
            pictures.append(picture.convert("RGB"))
        vectors: list[list[float]] = []
        with torch.inference_mode():
            for start in range(0, len(pictures), 32):
                inputs = self.processor(images=pictures[start:start + 32], return_tensors="pt")
                pixels = inputs["pixel_values"].to("cuda")
                features = self.model(pixel_values=pixels).pooler_output
                # Plain lists: the caller needs no torch to read the result.
                vectors.extend(torch.nn.functional.normalize(features, dim=-1).cpu().tolist())
        return vectors
