from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
import uuid
import httpx
from ultralytics import YOLO

# =============================
# SANAD SERVER CONFIG
# =============================
SANAD_SERVER_URL = os.getenv("SANAD_SERVER_URL", "http://localhost:5174")
SANAD_API_KEY    = os.getenv("SANAD_API_KEY",    "elderly-care-ai-api-key-2024")

async def send_fall_alert(elder_id: str, message: str, confidence: float, video_url: str = None):
    payload = {
        "elderId": elder_id,
        "type": "FALL",
        "message": message,
        "severity": "CRITICAL",
        "source": "FALL_DETECTION",
        "metadata": {
            "confidence": confidence,
            "fall_detected": True,
            "video_url": video_url
        }
    }
    headers = {"X-API-Key": SANAD_API_KEY, "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{SANAD_SERVER_URL}/api/alerts", json=payload, headers=headers)
    except Exception as e:
        print(f"⚠️ Failed to send FALL alert: {e}")

import cv2

# =============================
# VIDEO PROCESSING (OPTIMIZED)
# =============================
def process_video(input_path: str, output_path: str):
    cap = cv2.VideoCapture(input_path)
    try:
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        
        writer = cv2.VideoWriter(output_path, cv2.VideoWriter_fourcc(*'avc1'), fps, (width, height))
        
        fall_detected = False
        max_conf = 0.0
        frame_idx = 0
        
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret: break
            
            # Skip frames to boost performance (process 1 out of 5)
            if frame_idx % 5 == 0:
                results = model(frame, verbose=False, conf=0.5)[0]
                if len(results.boxes) > 0:
                    for box in results.boxes:
                        conf = float(box.conf[0])
                        if conf > max_conf: max_conf = conf
                        fall_detected = True 
                        
                        # Draw detection on frame
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 0, 255), 2)
                        cv2.putText(frame, f"FALL {conf:.2f}", (x1, y1-10), 
                                  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            
            writer.write(frame)
            frame_idx += 1
            
        writer.release()
        return {"fall_detected": fall_detected, "confidence": max_conf}
    finally:
        cap.release()

# =============================
# APP SETUP
# =============================
model = YOLO("best.pt")
app = FastAPI(title="Fall Detection API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

UPLOAD_DIR = "temp"
OUTPUT_DIR = "outputs"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")

@app.get("/")
def home(): return {"message": "Fall Detection API is running 🚀"}

@app.post("/detect/video")
async def detect_video(file: UploadFile = File(...), elder_id: str = ""):
    file_id = str(uuid.uuid4())
    input_path = os.path.join(UPLOAD_DIR, f"{file_id}.mp4")
    output_path = os.path.join(OUTPUT_DIR, f"{file_id}_out.mp4")
    
    with open(input_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    result = process_video(input_path, output_path)
    
    if result["fall_detected"] and elder_id:
        await send_fall_alert(elder_id, f"🚨 تحذير: تم اكتشاف حالة سقوط محتملة! (ثقة: {result['confidence']*100:.0f}%)", result["confidence"], f"/outputs/{file_id}_out.mp4")
        
    return JSONResponse({
        "fall_detected": result["fall_detected"],
        "confidence": result["confidence"],
        "video_url": f"/outputs/{file_id}_out.mp4"
    })

@app.post("/test/fall")
@app.get("/test/fall")
async def test_fall(elder_id: str = ""):
    if elder_id:
        # Pass a placeholder or a dedicated demo video for UI testing
        await send_fall_alert(elder_id, "🚨 [TEST] استغاثة! تم اكتشاف حالة سقوط (محاكاة تجريبية)", 0.99, "/outputs/demo_fall.mp4")
    return {"status": "ok", "message": "Fall simulation sent (with demo video link)", "is_test": True, "video_url": "/outputs/demo_fall.mp4"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8012)
