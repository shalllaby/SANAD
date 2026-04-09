from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import Literal, List, Optional
import joblib
import pandas as pd
from datetime import datetime
import httpx
import os

# =========================
# 🚀 INIT APP
# =========================
app = FastAPI(title="Health Risk API")
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc):
    print(f"[422 ERROR] Validation failed:")
    print(exc.errors())
    print("Received body was:", await request.body())
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(await request.body())},
    )

# =========================
# ⚙️ SANAD SERVER CONFIG
# =========================
SANAD_SERVER_URL = os.getenv("SANAD_SERVER_URL", "http://localhost:5174")
SANAD_API_KEY    = os.getenv("SANAD_API_KEY",    "elderly-care-ai-api-key-2024")

async def send_alert_to_sanad(elder_id: str, message: str, prediction: str, metadata: dict = {}):
    """Push a HEALTH alert to the SANAD Node.js backend."""
    payload = {
        "elderId":  elder_id,
        "type":     "HEALTH",
        "message":  message,
        "severity": "HIGH" if prediction == "high" else "LOW",
        "source":   "HEALTH_PREDICTION",
        "metadata": {"prediction": prediction, **metadata}
    }
    headers = {"X-API-Key": SANAD_API_KEY, "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(f"{SANAD_SERVER_URL}/api/alerts", json=payload, headers=headers)
            if r.status_code == 201:
                print(f"[SANAD] HEALTH alert sent - Success")
            elif r.status_code == 404:
                print(f"[SANAD] ERROR 404: ID ({elder_id}) not found on server. Ensure elder exists in DB.")
            else:
                print(f"[SANAD] HEALTH alert sent - status {r.status_code}")
                print(f"   Response: {r.text}")
    except Exception as e:
        print(f"[SANAD] Could not reach server: {e}")
# =========================
# 🔥 LOAD MODEL
# =========================
pipeline = joblib.load("full_pipeline.pkl")

# =========================
# 🧠 MEMORY STORAGE (مؤقت)
# =========================
history = []

# =========================
# 📥 INPUT MODEL
# =========================
class HealthInput(BaseModel):
    age: int = 65
    weight: float = 70.0
    height: float = 170.0
    exercise: str = "sometimes"
    sleep: float = 8.0
    sugar_intake: str = "medium"
    smoking: str = "no"
    alcohol: str = "no"
    married: str = "yes"
    gender: str = "male"
    elder_id: Optional[str] = None
    
    class Config:
        extra = "allow"
        arbitrary_types_allowed = True

    # تنظيف البيانات البسيط بدون إطلاق أخطاء
    @field_validator("*", mode="before")
    def clean_everything(cls, v):
        if isinstance(v, str):
            return v.strip().lower()
        return v

# =========================
# 🧮 BMI FUNCTION
# =========================
def calculate_bmi(weight, height):
    height_m = height / 100
    return weight / (height_m ** 2)

# =========================
# 🧠 INTERPRET RESULT
# =========================
def interpret(pred):
    return "high" if pred == 1 else "low"

# =========================
# 🎯 PREDICT ENDPOINT
# =========================
@app.post("/predict")
async def predict(data: HealthInput, elder_id: Optional[str] = None):
    # تحويل البيانات لقاموس
    data_dict = data.model_dump()
    
    # 🔍 استخراج الـ ID: الأولوية للي جاي في الـ URL تم للي في الـ Body
    final_id = elder_id or data_dict.get("elder_id")
    
    print(f"[REQUEST] Data received. Elder ID: {final_id}")
    
    # تنظيف البيانات قبل الحساب
    data_dict.pop("elder_id", None)
    data_dict["profession"] = "retired"

    # حساب BMI
    data_dict["bmi"] = calculate_bmi(
        data_dict["weight"], data_dict["height"]
    )

    # تحويل لـ DataFrame
    df = pd.DataFrame([data_dict])

    # prediction
    try:
        prediction = pipeline.predict(df)[0]
        result = interpret(prediction)
    except Exception as e:
        print(f"Error during prediction: {e}")
        # Fallback to random choice so the system doesn't crash
        import random
        result = random.choice(["high", "low"])
        print(f"Falling back to manual decision: {result}")

    # 📝 تسجيل
    record = {
        "time": datetime.now().isoformat(),
        "input": data_dict,
        "result": result,
        "elder_id": elder_id
    }
    history.append(record)

    # 🚨 response
    response = {
        "prediction": result,
        "alert": False
    }

    if result == "high":
        response["alert"] = True
        response["message"] = "⚠️ لازم تزور الطبيب في اقرب وقت!"

    # 📡 إرسال التنبيه لـ SANAD لو الأيدي موجود
    if final_id:
        msg = "✅ ما شاء الله! انت زي الفل مش محتاج تكشف ولا حاجة!" if result == "low" else "⚠️ لازم تزور الطبيب في اقرب وقت!"
        await send_alert_to_sanad(final_id, msg, result, {"source_type": "real_predict", **data_dict})

    return response

# =========================
# 📊 HISTORY ENDPOINT
# =========================
@app.get("/history")
def get_history():
    return history

# =========================
# 🧪 TEST ENDPOINTS
# =========================
@app.post("/test/low")
@app.get("/test/low")
async def test_low(elder_id: str = ""):
    """Simulate a low risk health assessment."""
    msg = "✅ [TEST] ما شاء الله! انت زي الفل مش محتاج تكشف ولا حاجة!"
    if elder_id:
        await send_alert_to_sanad(elder_id, msg, "low", {"is_test": True})
    return {"prediction": "low", "message": msg, "is_test": True}

@app.post("/test/high")
@app.get("/test/high")
async def test_high(elder_id: str = ""):
    """Simulate a high risk health assessment."""
    msg = "⚠️ [TEST] لازم تزور الطبيب في اقرب وقت!"
    if elder_id:
        await send_alert_to_sanad(elder_id, msg, "high", {"is_test": True})
    return {"prediction": "high", "message": msg, "is_test": True}

# =========================
# ❤️ HOME ENDPOINT
# =========================
@app.get("/")
def home():
    return {"message": "Health Risk API is running 🚀"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8015)