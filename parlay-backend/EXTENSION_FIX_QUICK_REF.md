# Fix for Chrome Extension "ERR_FILE_NOT_FOUND" Error

## 🎯 What Was Fixed

Your Chrome extension was getting a "file not found" error when trying to communicate with the backend API. This was caused by missing **CORS (Cross-Origin Resource Sharing)** configuration in the FastAPI server.

## ✅ What Changed

**File**: `parlay-backend/main.py`

**Added** (12 lines):
```python
from fastapi.middleware.cors import CORSMiddleware  # New import

# After app = FastAPI(...)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**Why**: Allows the Chrome extension running in your browser to make HTTP requests to the backend on port 8000.

## 🚀 How to Use the Fix

### Step 1: Start the Backend Server
```bash
cd parlay-backend
uvicorn main:app --reload --port 8000
```

Expected output:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### Step 2: Reload the Extension in Chrome
1. Go to `chrome://extensions/`
2. Find "Parlay Builder (MVP)"
3. Click the **reload** button (refresh icon)

### Step 3: Test It
1. Visit any website
2. Click the Parlay Builder extension icon
3. Verify backend URL is `http://127.0.0.1:8000`
4. Click "Capture legs from page" or "Suggest parlays"
5. **Should work now!** ✓

## 📊 How Extension & Backend Communicate

```
Extension                Backend
  ↓                        ↓
popup.js                main.py
  ↓                        ↓
fetch() to              FastAPI
http://127.0.0.1:8000   (+ CORS middleware)
  ↓                        ↓
[Browser checks         [Responds with
 CORS headers]          CORS headers] ✓

Before: ❌ No CORS headers → Browser blocks → Error
After:  ✅ CORS enabled → Browser allows → Works!
```

## 🔍 Troubleshooting

| Problem | Solution |
|---------|----------|
| Still getting error | Restart backend + reload extension (both 100%) |
| "Cannot connect to 127.0.0.1:8000" | Backend not running, run `uvicorn main:app --reload --port 8000` |
| Empty results, no error | Backend working! Just no good parlays found (normal) |
| Different error in console | Check backend server stdout for actual errors |

## 📁 Files Changed

✅ `parlay-backend/main.py` - Added CORS middleware  
✅ `CHROME_EXTENSION_FIX.md` - This documentation

## 🔐 Production Note

The current CORS setting allows **all origins** (`allow_origins=["*"]`). This is fine for local development, but for production, restrict to your extension ID:

```python
allow_origins=[
    "chrome-extension://YOUR_EXT_ID_HERE",
]
```

## Summary

✓ **Problem**: CORS headers missing  
✓ **Solution**: Added CORS middleware to FastAPI  
✓ **Result**: Extension ↔ Backend communication now works  
✓ **Testing**: Restart backend + reload extension  

That's it! The extension should work now. 🎉
