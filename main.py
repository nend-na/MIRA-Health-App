from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, field_validator
from typing import Optional
import sqlite3, os, re
from pathlib import Path
from datetime import date, datetime
from dotenv import load_dotenv
import httpx

app = FastAPI(title="MIRA Health Prediction")
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

load_dotenv(BASE_DIR / ".env")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1").strip()
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
DB_PATH = str(BASE_DIR / "health_records.db")


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS patients (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name   TEXT NOT NULL,
            dob         TEXT NOT NULL,
            email       TEXT NOT NULL UNIQUE,
            glucose     REAL NOT NULL,
            haemoglobin REAL NOT NULL,
            cholesterol REAL NOT NULL,
            remarks     TEXT,
            created_at  TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()

init_db()


class PatientCreate(BaseModel):
    full_name: str
    dob: str
    email: str
    glucose: float
    haemoglobin: float
    cholesterol: float

    @field_validator("dob")
    def dob_not_future(cls, v):
        try:
            d = datetime.strptime(v, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError("Date must be YYYY-MM-DD.")
        if d >= date.today():
            raise ValueError("Date of birth cannot be a future date.")
        return v

    @field_validator("email")
    def valid_email(cls, v):
        if not re.match(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$", v):
            raise ValueError("Invalid email address format.")
        return v.lower()

    @field_validator("glucose", "haemoglobin", "cholesterol")
    def positive(cls, v):
        if v <= 0:
            raise ValueError("Value must be positive.")
        return v


class PatientUpdate(BaseModel):
    full_name: Optional[str] = None
    dob: Optional[str] = None
    email: Optional[str] = None
    glucose: Optional[float] = None
    haemoglobin: Optional[float] = None
    cholesterol: Optional[float] = None


def _extract_response_text(response_json: dict) -> str:
    try:
        return response_json["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        return ""


def _sanitize_prediction_text(text: str) -> str:
    if not isinstance(text, str):
        return ""
    text = re.sub(r"\s+", " ", text.strip())
    if not text:
        return ""

    lines = [line.strip() for line in re.split(r"[\r\n]+", text) if line.strip()]
    cleaned_lines = []
    for line in lines:
        if re.match(r"^(we need|let's|so |please |do not|dont |return only|respond with|provide only|make sure)", line, re.I):
            continue
        cleaned_lines.append(line)
    clean_text = " ".join(cleaned_lines) if cleaned_lines else text

    sentences = re.split(r"(?<=[.!?])\s+", clean_text)
    filtered = [s.strip() for s in sentences if s.strip() and not re.match(
        r"^(we need|let's|so |please |do not|dont |return only|respond with|provide only|make sure)",
        s.strip(), re.I
    )]
    if not filtered:
        filtered = [s.strip() for s in sentences if s.strip()]
    if len(filtered) > 3:
        filtered = filtered[:3]
    return " ".join(filtered).strip()


def get_health_prediction(full_name, dob, glucose, haemoglobin, cholesterol):
    if not GROQ_API_KEY:
        return "AI prediction unavailable — GROQ_API_KEY not configured."
    
    print(">>> GROQ_API_KEY:", GROQ_API_KEY[:8], "...")  # only prints first 8 chars for safety
    print(">>> GROQ_MODEL:", GROQ_MODEL)
    print(">>> GROQ_BASE_URL:", GROQ_BASE_URL)

    age = (date.today() - datetime.strptime(dob, "%Y-%m-%d").date()).days // 365
    prompt = (
        "You are a clinical decision-support assistant. "
        "Given patient lab results, return only the final health risk assessment. "
        "Use 2-3 concise sentences in third person. "
        "State likely health conditions or risks and one recommended follow-up plan. "
        "If any value is abnormal, mention that value and the associated risk. "
        "If cholesterol is elevated, include a cholesterol-related risk and next step. "
        "Do not include any instructions, analysis, meta commentary, or disclaimers. "
        "Do not repeat the task. Return only the final assessment.\n\n"
        f"Patient: {full_name}, Age: {age}\n"
        f"Fasting Blood Glucose: {glucose} mg/dL\n"
        f"Haemoglobin: {haemoglobin} g/dL\n"
        f"Total Cholesterol: {cholesterol} mg/dL"
    )

    url = f"{GROQ_BASE_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": GROQ_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 220,
        "temperature": 0.2,
    }

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(url, headers=headers, json=payload)
            if response.status_code == 401:
                return "AI prediction unavailable — invalid GROQ API key."
            if response.status_code >= 400:
                try:
                    err = response.json()
                    message = err.get("error", {}).get("message") or err.get("message") or response.text
                except Exception:
                    message = response.text
                return f"Prediction error: {message}"

            prediction = _extract_response_text(response.json())
            prediction = _sanitize_prediction_text(prediction)

            try:
                chol_val = float(cholesterol)
            except Exception:
                chol_val = None

            if prediction and chol_val is not None and chol_val >= 200:
                lower = prediction.lower()
                chol_str = str(int(chol_val))
                if "cholesterol" not in lower or (chol_str not in lower and str(chol_val) not in lower):
                    extra = (
                        f"Cholesterol: {int(chol_val)} mg/dL — elevated; recommend confirming with a fasting lipid panel "
                        "(LDL/HDL/triglycerides) and clinician review."
                    )
                    if age < 18:
                        extra += (
                            " For adolescents, evaluate family history and secondary causes "
                            "(e.g. diet, endocrine or nephrotic disorders) and discuss with the pediatrician."
                        )
                    prediction = f"{prediction} {extra}"

            return prediction or "AI prediction unavailable at this time."

    except Exception as e:
        return f"Prediction error: {str(e)}"


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")

@app.get("/api/patients")
def list_patients():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute("SELECT * FROM patients ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/patients/{pid}")
def get_patient(pid: int):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Patient not found.")
    return dict(row)

@app.post("/api/patients", status_code=201)
def create_patient(data: PatientCreate):
    remarks = get_health_prediction(
        data.full_name, data.dob, data.glucose, data.haemoglobin, data.cholesterol
    )
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.execute(
            "INSERT INTO patients (full_name,dob,email,glucose,haemoglobin,cholesterol,remarks) VALUES (?,?,?,?,?,?,?)",
            (data.full_name, data.dob, data.email, data.glucose, data.haemoglobin, data.cholesterol, remarks)
        )
        conn.commit()
        new_id = cur.lastrowid
        conn.close()
        return {"id": new_id, "remarks": remarks, "message": "Patient record created."}
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A patient with this email already exists.")

@app.put("/api/patients/{pid}")
def update_patient(pid: int, data: PatientUpdate):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM patients WHERE id=?", (pid,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Patient not found.")
    ex = dict(row)
    upd = {
        "full_name":   data.full_name   or ex["full_name"],
        "dob":         data.dob         or ex["dob"],
        "email":       data.email       or ex["email"],
        "glucose":     data.glucose     if data.glucose     is not None else ex["glucose"],
        "haemoglobin": data.haemoglobin if data.haemoglobin is not None else ex["haemoglobin"],
        "cholesterol": data.cholesterol if data.cholesterol is not None else ex["cholesterol"],
    }
    remarks = get_health_prediction(
        upd["full_name"], upd["dob"],
        upd["glucose"], upd["haemoglobin"], upd["cholesterol"]
    )
    conn.execute(
        "UPDATE patients SET full_name=?,dob=?,email=?,glucose=?,haemoglobin=?,cholesterol=?,remarks=? WHERE id=?",
        (upd["full_name"], upd["dob"], upd["email"],
         upd["glucose"], upd["haemoglobin"], upd["cholesterol"], remarks, pid)
    )
    conn.commit()
    conn.close()
    return {"message": "Record updated.", "remarks": remarks}

@app.delete("/api/patients/{pid}")
def delete_patient(pid: int):
    conn = sqlite3.connect(DB_PATH)
    r = conn.execute("DELETE FROM patients WHERE id=?", (pid,))
    conn.commit()
    conn.close()
    if r.rowcount == 0:
        raise HTTPException(404, "Patient not found.")
    return {"message": "Record deleted."}