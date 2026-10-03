# Cosmos 3 Reasoner NIM Setup

The Aloha Circle kiosk uses **NVIDIA Cosmos 3 Reasoner NIM** as a second-opinion
VLM judge when a gesture stage stalls (~8s). It is **not** the live pose
detector (that's MoveNet); Cosmos provides physical-AI reasoning about whether
the visitor completed a gesture when the keypoint detector is uncertain.

## Architecture

```
Live pose loop (10 fps):
  camera → MoveNet → keypoints → gestures.js predicates → stage advance

Stall fallback (~8s):
  camera snapshot (JPEG) → cosmos.cjs → Cosmos 3 NIM → YES/NO → stage advance
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COSMOS_NIM_URL` | Yes | _(unset)_ | OpenAI-compatible chat completions endpoint |
| `COSMOS_API_KEY` | No | _(unset)_ | Bearer token for NIM authentication |
| `NVIDIA_API_KEY` | No | _(unset)_ | Fallback for `COSMOS_API_KEY` |
| `COSMOS_MODEL` | No | `nvidia/cosmos3-nano-reasoner` | Model name to request |
| `COSMOS_TIMEOUT_MS` | No | `5000` | Request timeout in milliseconds |

When `COSMOS_NIM_URL` is unset, the cosmos hook returns `{ ok: false, source: 'unset' }`
and the kiosk continues with keypoint-only advancement (no crash, no hang).

## Option 1: NVIDIA API Catalog (Cloud)

The fastest way to test is NVIDIA's hosted API catalog:

```bash
# Get an API key from https://build.nvidia.com/nvidia/cosmos3-nano-reasoner
export COSMOS_NIM_URL=https://integrate.api.nvidia.com/v1/chat/completions
export COSMOS_API_KEY=nvapi-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
export COSMOS_MODEL=nvidia/cosmos3-nano-reasoner
```

## Option 2: CoreWeave GPU Instance

For production or lower-latency hackathon demos, run the NIM container on a
CoreWeave GPU instance (RTX PRO 6000, A100, H100, or newer).

### Prerequisites

1. **CoreWeave account** with GPU quota
2. **API key** from SSM (never commit it):
   ```bash
   export COREWEAVE_API_KEY=$(aws ssm get-parameter \
     --name /alohaintelligence/production/coreweave_api_key \
     --with-decryption --query Parameter.Value --output text)
   ```
3. **NGC API key** for pulling NIM containers: https://ngc.nvidia.com/setup/api-key

### Launch the NIM container

SSH into your CoreWeave instance and run:

```bash
# Authenticate to NGC
docker login nvcr.io -u '$oauthtoken' -p $NGC_API_KEY

# Pull and run Cosmos 3 Nano Reasoner NIM
# Requires ~16GB VRAM (RTX PRO 6000 / A100-40GB / H100)
docker run --gpus all -d \
  --name cosmos3-nim \
  -p 8000:8000 \
  -e NGC_API_KEY=$NGC_API_KEY \
  nvcr.io/nim/nvidia/cosmos3-nano-reasoner:latest

# Verify it's running
curl -s http://localhost:8000/v1/models | jq .
```

### Configure the kiosk

```bash
export COSMOS_NIM_URL=http://<coreweave-instance-ip>:8000/v1/chat/completions
export COSMOS_API_KEY=  # NIM container doesn't require auth by default
export COSMOS_MODEL=nvidia/cosmos3-nano-reasoner
```

## Option 3: Local GPU (Jetson / RTX Desktop)

For fully on-prem deployment (no venue Wi-Fi dependency), Cosmos 3 Edge (4B)
runs on Jetson Orin or RTX-class desktop GPUs.

### Jetson Orin

```bash
# Pull the Edge NIM container (smaller model, ~8GB VRAM)
docker pull nvcr.io/nim/nvidia/cosmos3-edge-reasoner:latest

docker run --runtime nvidia -d \
  --name cosmos3-edge \
  -p 8000:8000 \
  nvcr.io/nim/nvidia/cosmos3-edge-reasoner:latest
```

### RTX Desktop (3090, 4090, etc.)

```bash
docker run --gpus all -d \
  --name cosmos3-nim \
  -p 8000:8000 \
  -e NGC_API_KEY=$NGC_API_KEY \
  nvcr.io/nim/nvidia/cosmos3-nano-reasoner:latest
```

Then configure:

```bash
export COSMOS_NIM_URL=http://127.0.0.1:8000/v1/chat/completions
```

## Testing the Connection

```bash
# Quick health check
curl -s http://localhost:8000/v1/models

# Test a gesture judgment (replace with actual base64 JPEG)
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/cosmos3-nano-reasoner",
    "max_tokens": 64,
    "messages": [{
      "role": "user",
      "content": [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,/9j/4AAQ..."}},
        {"type": "text", "text": "Is the person covering their eyes with their hands? Answer YES or NO only."}
      ]
    }]
  }'
```

## Graceful Degradation

The kiosk is designed for unreliable venue Wi-Fi:

1. **Unset URL**: Returns `{ ok: false, source: 'unset' }` immediately
2. **Timeout** (default 5s): Returns `{ ok: false, source: 'timeout' }`
3. **Network/HTTP error**: Returns `{ ok: false, source: 'error' }`

In all failure cases, the kiosk falls back to keypoint-only stage advancement.
The visitor experience continues; they just don't get the VLM second opinion.

## Model Comparison

| Model | Size | VRAM | Latency | Use Case |
|-------|------|------|---------|----------|
| `cosmos3-edge-reasoner` | 4B | ~8GB | ~200ms | Jetson / RTX desktop (on-prem) |
| `cosmos3-nano-reasoner` | 16B | ~16GB | ~400ms | RTX PRO 6000 / A100 (default) |
| `cosmos3-super-reasoner` | 65B | ~80GB | ~1.2s | H100 / multi-GPU (overkill for stall judge) |

For the stall-judge use case (one frame every ~8s when needed), Nano is the sweet
spot. Edge is viable for fully offline kiosks.

## Troubleshooting

**Container won't start:**
- Check VRAM: `nvidia-smi`
- Check NGC auth: `docker login nvcr.io`

**Slow responses:**
- Increase `COSMOS_TIMEOUT_MS` (default 5000ms)
- Consider Edge model for lower latency

**Always returning NO:**
- Verify the image is a valid JPEG data URL
- Check prompt clarity (use YES/NO only format)

## References

- [Cosmos 3 NIM Docs](https://docs.nvidia.com/nim/vision-language-models/1.7.0/examples/cosmos-reason3/api.html)
- [Cosmos 3 on Hugging Face](https://huggingface.co/collections/nvidia/cosmos3)
- [NIM Container Registry](https://catalog.ngc.nvidia.com/orgs/nim/teams/nvidia/containers/cosmos3-nano-reasoner)
- [CoreWeave GPU Instances](https://docs.coreweave.com/)
