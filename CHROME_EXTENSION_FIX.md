# Chrome Extension File Access Error - SOLUTION

## Problem

When using the Parlay Builder Chrome extension, you get this error:

```
Your file couldn't be accessed
It may have been moved, edited, or deleted.
ERR_FILE_NOT_FOUND
```

## Root Cause

**The backend (FastAPI server) was missing CORS (Cross-Origin Resource Sharing) configuration.**

The extension runs in the browser and makes HTTP requests to `http://127.0.0.1:8000`, but without CORS headers, the browser blocks these requests for security reasons. Chrome then displays this confusing "file not found" error instead of the actual CORS error.

## Solution Applied

Added CORS middleware to `main.py`:

```python
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Parlay Builder API", version="0.1.0")

# Enable CORS for Chrome extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

## How to Test the Fix

### 1. Start the Backend Server
```bash
cd parlay-backend
uvicorn main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

### 2. Open or Reload the Extension
- Go to `chrome://extensions/`
- Find "Parlay Builder (MVP)"
- Click the reload button

### 3. Test the Extension
1. Go to any webpage (e.g., a sportsbook)
2. Click the Parlay Builder extension icon
3. Make sure backend URL is set to `http://127.0.0.1:8000`
4. Click "Capture legs from page" or "Suggest parlays"
5. Should now work without the file error!

## Files Modified

**✅ `/parlay-backend/main.py`**
- Added import: `from fastapi.middleware.cors import CORSMiddleware`
- Added middleware configuration after FastAPI app initialization

**No other files needed to change!**

## Architecture

### How Extension & Backend Work Together

```
Chrome Extension (parlay-extension/)
    ↓
popup.html (UI form)
    ↓
popup.js (form handling + API calls)
    ↓
fetch() to http://127.0.0.1:8000/v1/parlays/suggest

Responses now use a stable envelope:

```json
{
  "api_version":"1.0",
  "parlays":[ ... ],
  "summary":{ ... },
  "errors":null
}
```

Frontends should read `parlays` and look under `summary` for exposure/metrics; older clients can still check top-level fields.
    ↓ (Browser CORS policy check)
    ↓
FastAPI Backend (main.py)
    ↓ (CORS module checks headers)
    ↓
Response with CORS headers
    ↓
Browser receives response + renders data
```

**Before Fix**: CORS headers were missing → browser blocked request → extension showed confusing error

**After Fix**: CORS headers present → browser allows request → backend responds normally → extension displays results

## CORS Headers Explained

The middleware automatically adds these HTTP response headers:

```
Access-Control-Allow-Origin: * 
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, ...
Access-Control-Allow-Headers: * 
Access-Control-Allow-Credentials: true
```

These tell the browser: "It's OK for extensions to request this API."

## Security Note

Currently, CORS is set to `allow_origins=["*"]` (allow everyone). For production, you should:

```python
# More restrictive (recommended for production):
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://YOUR_EXTENSION_ID",  # Only your extension
        "http://localhost:3000",  # Local dev
    ],
    allow_credentials=True,
    allow_methods=["POST"],  # Only POST needed for /v1/parlays/suggest
    allow_headers=["Content-Type"],  # Only JSON content
)
```

But for MVP/local development, the current setting is fine.

## Common Issues & Troubleshooting

### Issue: Still getting the error after fix

**Solution**: 
1. Make sure backend server is running on port 8000
   ```bash
   ps aux | grep uvicorn  # Check if it's running
   ```
2. Reload the extension (chrome://extensions → reload button)
3. Check backend URL in popup.html settings is exactly: `http://127.0.0.1:8000`
4. Check browser console (F12) for actual error messages

### Issue: "Cannot POST /v1/parlays/suggest"

**Solution**: 
The endpoint exists, but make sure:
- Backend server is running (see above)
- Payload is valid JSON
- Check Chrome DevTools → Network tab to see actual request/response

### Issue: Extension works but returns empty results

**Solution**: 
This is expected behavior (not related to this CORS fix). It means:
- Extension successfully connected to backend ✓
- Backend received the legs ✓
- Portfolio optimization ran but found no good parlays
- This is normal if legs don't have positive EV or too restrictive settings

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| **CORS Setup** | ❌ Missing | ✅ Configured |
| **Browser Blocks Requests** | ❌ Yes | ✅ No |
| **Error Message** | ERR_FILE_NOT_FOUND | Working! |
| **Extension → Backend Communication** | ❌ Blocked | ✅ Allowed |

## Next Steps

1. ✅ Applied CORS fix to main.py
2. Start backend: `uvicorn main:app --reload --port 8000`
3. Reload extension in Chrome
4. Test with any webpage
5. Report back if you have any issues!

---

**Changed Files**: `parlay-backend/main.py` (added 2 import + 10 lines of middleware config)  
**Impact**: Enables extension↔backend communication  
**Testing**: Restart backend + reload extension  
