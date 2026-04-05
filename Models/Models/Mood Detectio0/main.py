from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

import cv2
import os
import shutil
import uuid
import httpx
from collections import Counter, defaultdict
from ultralytics import YOLO

# =============================
# SANAD SERVER CONFIG
# =============================

SANAD_SERVER_URL = os.getenv("SANAD_SERVER_URL", "http://localhost:5174")
SANAD_API_KEY    = os.getenv("SANAD_API_KEY",    "elderly-care-ai-api-key-2024")

EMOTION_SCORE = {
    "happy":   1.0,
    "natural": 0.7,
    "surprise":0.5,
    "disgust": 0.3,
    "sad":     0.2,
    "angry":   0.1,
    "other":   0.5,
}

async def push_mood_to_sanad(elder_id: str, emotion: str, confidence: float, status: str, video_url: str = None):
    """Save mood reading to HealthData and push alert only when status is 'risk'."""
    headers = {"X-API-Key": SANAD_API_KEY, "Content-Type": "application/json"}

    # 1️⃣  Save to Health Records (For the Charts/Reports)
    # This is what populates the "Psychological Status Details"
    hp = {
        "elderId":    elder_id,
        "moodScore":  float(EMOTION_SCORE.get(emotion, 0.5)),
        "moodLabel":  emotion.lower().strip(),
        "source":     "MOOD_DETECTION"
    }
    
    print(f"📡 [SYNC] Sending to SANAD Reports: {emotion} for {elder_id}")
    
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            h_res = await client.post(f"{SANAD_SERVER_URL}/api/health/mood", json=hp, headers=headers)
            if h_res.status_code == 201:
                print(f"✅ [SUCCESS] Health report applied")
            else:
                print(f"❌ [FAIL] Health report error: {h_res.status_code}")
    except Exception as e:
        print(f"🚨 [ERROR] Connection failure: {e}")

    # 2️⃣  Alert SANAD (For the Live Notifications)
    severity_map = {"risk": "MEDIUM", "warning": "LOW", "healthy": "INFO", "unknown": "INFO"}
    
    ap = {
        "elderId":  elder_id,
        "type":     "MOOD",
        "message":  f"🎭 رصد حالة نفسية: {emotion}",
        "severity": severity_map.get(status, "INFO"),
        "source":   "MOOD_DETECTION",
        "metadata": {"emotion": emotion, "confidence": confidence, "status": status}
    }
    
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{SANAD_SERVER_URL}/api/alerts", json=ap, headers=headers)
            print(f"🔔 [SYNC] Alert pushed")
    except Exception as e:
        print(f"⚠️ [WARN] Alert push failed: {e}")

# =============================
# CONFIG
# =============================

MODEL_PATH = "best.pt"   # غيره لاسم ملف الويتس عندك
UPLOAD_DIR = "temp"
OUTPUT_DIR = "outputs"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

EMOTION_CONF = 0.35

model = YOLO(MODEL_PATH)

# =============================
# FASTAPI
# =============================

app = FastAPI(title="😊 Emotion Detection API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # للتجربة
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")


@app.get("/")
def home():
    return {"message": "Emotion API is running 🚀"}


@app.get("/health")
def health():
    return {"status": "ok"}


# =============================
# UTILS
# =============================

def normalize_emotion(name: str) -> str:
    name = name.lower().strip()

    if name in ["natural", "neutral"]:
        return "natural"
    if name == "happy":
        return "happy"
    if name == "sad":
        return "sad"
    if name == "angry":
        return "angry"
    if name in ["disgust", "disgusted"]:
        return "disgust"
    if name in ["surprise", "surprised"]:
        return "surprise"

    return "other"



def emotion_to_status(emotion: str) -> str:
    if emotion in ["happy", "natural"]:
        return "healthy"
    if emotion in ["surprise", "disgust"]:
        return "warning"
    if emotion in ["sad", "angry"]:
        return "risk"
    return "unknown"


def safe_box_area(x1: int, y1: int, x2: int, y2: int) -> int:
    return max(0, x2 - x1) * max(0, y2 - y1)


# =============================
# IMAGE PROCESSING
# =============================

def process_image(input_path: str, output_path: str):
    frame = cv2.imread(input_path)
    if frame is None:
        raise Exception("Cannot read image")

    results = model(frame, verbose=False, conf=0.25)[0]
    boxes = results.boxes

    detections = []
    best_conf = 0.0
    dominant_emotion = None

    for box in boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])

        if conf < EMOTION_CONF:
            continue

        x1, y1, x2, y2 = map(int, box.xyxy[0])

        raw_class = model.names[cls_id]
        emotion = normalize_emotion(raw_class)

        detections.append({
            "emotion": emotion,
            "confidence": round(conf, 3),
            "bbox": [x1, y1, x2, y2]
        })

        if conf > best_conf:
            best_conf = conf
            dominant_emotion = emotion

        color = (0, 255, 0)
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        cv2.putText(
            frame,
            f"{emotion} {conf:.2f}",
            (x1, max(20, y1 - 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            color,
            2
        )

    cv2.imwrite(output_path, frame)

    if not detections:
        return {
            "detected": False,
            "dominant_emotion": "none",
            "status": "unknown",
            "confidence": 0,
            "detections": []
        }

    return {
        "detected": True,
        "dominant_emotion": dominant_emotion,
        "status": emotion_to_status(dominant_emotion),
        "confidence": round(best_conf, 3),
        "detections": detections
    }


# =============================
# VIDEO PROCESSING
# =============================

def process_video(input_path: str, output_path: str):
    cap = cv2.VideoCapture(input_path)

    if not cap.isOpened():
        raise Exception("Cannot open video")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if not fps or fps <= 0:
        fps = 25

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    writer = cv2.VideoWriter(
        output_path,
        cv2.VideoWriter_fourcc(*"avc1"),
        fps,
        (width, height)
    )

    emotion_counts = Counter()
    emotion_confidences = defaultdict(list)
    total_detections = 0

    frame_idx = 0
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # Skip frames to boost performance (process 1 out of 5)
            if frame_idx % 5 == 0:
                results = model(frame, verbose=False, conf=0.25)[0]
                boxes = results.boxes

                frame_best_emotion = None
                frame_best_conf = 0.0
                frame_best_box = None

                # لو في أكثر من وجه في الفريم، نأخذ الأعلى ثقة
                for box in boxes:
                    cls_id = int(box.cls[0])
                    conf = float(box.conf[0])

                    if conf < EMOTION_CONF:
                        continue

                    x1, y1, x2, y2 = map(int, box.xyxy[0])

                    raw_class = model.names[cls_id]
                    emotion = normalize_emotion(raw_class)

                    if conf > frame_best_conf:
                        frame_best_conf = conf
                        frame_best_emotion = emotion
                        frame_best_box = (x1, y1, x2, y2)

                if frame_best_emotion is not None:
                    emotion_counts[frame_best_emotion] += 5 # account for skipped
                    emotion_confidences[frame_best_emotion].append(frame_best_conf)
                    total_detections += 5

                    x1, y1, x2, y2 = frame_best_box
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(
                        frame,
                        f"{frame_best_emotion} {frame_best_conf:.2f}",
                        (x1, max(20, y1 - 10)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7,
                        (0, 255, 0),
                        2
                    )

            writer.write(frame)
            frame_idx += 1

        writer.release()
    finally:
        cap.release()

    if total_detections == 0:
        return {
            "detected": False,
            "dominant_emotion": "none",
            "status": "unknown",
            "confidence": 0,
            "emotion_counts": {}
        }

    dominant_emotion = emotion_counts.most_common(1)[0][0]
    avg_conf = sum(emotion_confidences[dominant_emotion]) / len(emotion_confidences[dominant_emotion])

    return {
        "detected": True,
        "dominant_emotion": dominant_emotion,
        "status": emotion_to_status(dominant_emotion),
        "confidence": round(avg_conf, 3),
        "emotion_counts": dict(emotion_counts)
    }


# =============================
# IMAGE ENDPOINT
# =============================

@app.post("/detect/emotion/image")
async def detect_emotion_image(
    file: UploadFile = File(...),
    elder_id: str = ""
):
    if not file.filename.lower().endswith((".jpg", ".jpeg", ".png")):
        raise HTTPException(status_code=400, detail="Invalid image format")

    file_id     = str(uuid.uuid4())
    input_path  = os.path.join(UPLOAD_DIR, f"{file_id}.jpg")
    output_path = os.path.join(OUTPUT_DIR,  f"{file_id}_emotion.jpg")

    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    result = process_image(input_path, output_path)

    # ── Push mood data & alert to SANAD ──────────────────────────────────
    if result["detected"] and elder_id:
        await push_mood_to_sanad(
            elder_id   = elder_id,
            emotion    = result["dominant_emotion"],
            confidence = result["confidence"],
            status     = result["status"]
        )

    return JSONResponse({
        "detected":         result["detected"],
        "dominant_emotion": result["dominant_emotion"],
        "status":           result["status"],
        "confidence":       result["confidence"],
        "detections":       result["detections"],
        "image_url":        f"/outputs/{file_id}_emotion.jpg"
    })


# =============================
# VIDEO ENDPOINT
# =============================

@app.post("/detect/emotion/video")
async def detect_emotion_video(
    file: UploadFile = File(...),
    elder_id: str = ""
):
    if not file.filename.lower().endswith((".mp4", ".avi", ".mov", ".mkv")):
        raise HTTPException(status_code=400, detail="Invalid video format")

    file_id     = str(uuid.uuid4())
    input_path  = os.path.join(UPLOAD_DIR, f"{file_id}.mp4")
    output_path = os.path.join(OUTPUT_DIR,  f"{file_id}_emotion.mp4")

    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    result = process_video(input_path, output_path)

    # ── Push mood data & alert to SANAD ──────────────────────────────────
    if result["detected"] and elder_id:
        await push_mood_to_sanad(
            elder_id   = elder_id,
            emotion    = result["dominant_emotion"],
            confidence = result["confidence"],
            status     = result["status"]
        )

    return JSONResponse({
        "detected":         result["detected"],
        "dominant_emotion": result["dominant_emotion"],
        "status":           result["status"],
        "confidence":       result["confidence"],
        "emotion_counts":   result["emotion_counts"],
        "video_url":        f"/outputs/{file_id}_emotion.mp4"
    })


# =============================
# TEST ENDPOINTS (For Simulation)
# =============================

@app.post("/test/happy")
@app.get("/test/happy")
async def test_happy(elder_id: str = ""):
    """Simulate a happy state."""
    result = {
        "detected":         True,
        "dominant_emotion": "happy",
        "status":           "normal",
        "confidence":       0.95,
        "emotion_counts":   {"happy": 20, "natural": 5},
        "video_url":        "/outputs/test_happy.mp4",
        "is_simulation":    True
    }
    if elder_id:
        await push_mood_to_sanad(elder_id, "happy", 0.95, "normal")
    return JSONResponse(result)


@app.post("/test/sad")
@app.get("/test/sad")
async def test_sad(elder_id: str = ""):
    """Simulate a sad state."""
    result = {
        "detected":         True,
        "dominant_emotion": "sad",
        "status":           "risk",
        "confidence":       0.88,
        "emotion_counts":   {"sad": 22, "natural": 3},
        "video_url":        "/outputs/test_sad.mp4",
        "is_simulation":    True
    }
    if elder_id:
        await push_mood_to_sanad(elder_id, "sad", 0.88, "risk", "/outputs/test_sad.mp4")
    return JSONResponse(result)


@app.post("/test/angry")
@app.get("/test/angry")
async def test_angry(elder_id: str = ""):
    """Simulate an angry state."""
    result = {
        "detected":         True,
        "dominant_emotion": "angry",
        "status":           "risk",
        "confidence":       0.92,
        "emotion_counts":   {"angry": 18, "surprise": 2},
        "video_url":        "/outputs/test_angry.mp4",
        "is_simulation":    True
    }
    if elder_id:
        await push_mood_to_sanad(elder_id, "angry", 0.92, "risk", "/outputs/test_angry.mp4")
    return JSONResponse(result)

@app.post("/test/natural")
@app.get("/test/natural")
@app.post("/test/neutral")
@app.get("/test/neutral")
async def test_natural(elder_id: str = ""):

    """Simulate a natural state."""
    result = {
        "detected":         True,
        "dominant_emotion": "natural",
        "status":           "normal",
        "confidence":       0.90,
        "emotion_counts":   {"natural": 25, "happy": 2},
        "video_url":        "/outputs/test_natural.mp4",
        "is_simulation":    True
    }
    if elder_id:
        await push_mood_to_sanad(elder_id, "natural", 0.90, "normal")
    return JSONResponse(result)

@app.post("/test/surprise")
@app.get("/test/surprise")
@app.post("/test/surprised")
@app.get("/test/surprised")
async def test_surprise(elder_id: str = ""):

    """Simulate a surprise state."""
    result = {
        "detected":         True,
        "dominant_emotion": "surprise",
        "status":           "attention",
        "confidence":       0.85,
        "emotion_counts":   {"surprise": 15, "natural": 5},
        "video_url":        "/outputs/test_surprise.mp4",
        "is_simulation":    True
    }
    if elder_id:
        await push_mood_to_sanad(elder_id, "surprise", 0.85, "attention")
    return JSONResponse(result)

@app.post("/test/disgust")
@app.get("/test/disgust")
@app.post("/test/disgusted")
@app.get("/test/disgusted")
async def test_disgust(elder_id: str = ""):

    """Simulate a disgust state."""
    result = {
        "detected":         True,
        "dominant_emotion": "disgust",
        "status":           "attention",
        "confidence":       0.88,
        "emotion_counts":   {"disgust": 14, "angry": 3},
        "video_url":        "/outputs/test_disgust.mp4",
        "is_simulation":    True
    }
    if elder_id:
        await push_mood_to_sanad(elder_id, "disgust", 0.88, "attention")
    return JSONResponse(result)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8014)
