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
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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
            print(f"[SANAD] HEALTH alert sent - status {r.status_code}")
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
    age: int
    weight: float
    height: float
    exercise: str 
    sleep: float   # ✅ مهم جدًا
    sugar_intake: Literal["low", "medium", "high"]
    smoking: Literal["yes", "no"]
    alcohol: Literal["yes", "no"]
    married: Literal["yes", "no"]
    elder_id: Optional[str] = None # 🔥 لإرسال التنبيه تلقائياً
    # profession: str (Removed from input, using default 'retired')

    # 🔥 تنظيف الـ strings للحقول النصية للتنبؤ فقط (مع استبعاد الـ elder_id لأنه حساس لحالة الأحرف)
    @field_validator("exercise", "sugar_intake", "smoking", "alcohol", "married", mode="before")
    def clean_strings(cls, value):
        if isinstance(value, str):
            return value.strip().lower()
        return value

    # 🔥 validations
    @field_validator("height")
    def validate_height(cls, v):
        if v <= 0:
            raise ValueError("Height must be positive")
        return v

    @field_validator("weight")
    def validate_weight(cls, v):
        if v <= 0:
            raise ValueError("Weight must be positive")
        return v

    @field_validator("age")
    def validate_age(cls, v):
        if v < 0 or v > 120:
            raise ValueError("Invalid age")
        return v

    @field_validator("sleep")
    def validate_sleep(cls, v):
        if v < 0 or v > 24:
            raise ValueError("Sleep must be between 0 and 24")
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
async def predict(data: HealthInput):

    data_dict = data.model_dump()
    elder_id = data_dict.pop("elder_id", None) # نشيل الأيدي من بيانات التحليل
    print(f"[DEBUG] Received elder_id for real predict: {elder_id}")
    data_dict["profession"] = "retired" # Default value for the trained model

    # 🔥 حساب BMI
    data_dict["bmi"] = calculate_bmi(
        data_dict["weight"], data_dict["height"]
    )

    # 🔥 تحويل لـ DataFrame
    df = pd.DataFrame([data_dict])

    # 🔥 prediction
    prediction = pipeline.predict(df)[0]
    result = interpret(prediction)

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
    if elder_id:
        msg = "✅ ما شاء الله! انت زي الفل مش محتاج تكشف ولا حاجة!" if result == "low" else "⚠️ لازم تزور الطبيب في اقرب وقت!"
        await send_alert_to_sanad(elder_id, msg, result, {"source_type": "real_predict", **data_dict})

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