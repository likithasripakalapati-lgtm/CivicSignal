# CivicSignal

Your Neighbourhood. Your Language. Your Information.

CivicSignal is a bilingual public information platform for English (`en-IN`) and Telugu (`te-IN`). It includes MongoDB-backed accounts, private PDF/JPG/PNG storage, queued document extraction, page-level progress, English/Telugu OCR, evidence-backed Gemini translation and explanation, and a notice question-answering interface and API. Speech input uses local Whisper transcription; Telugu answers can be spoken locally in the browser, while English answers use browser speech synthesis. Source authenticity remains explicitly unverified. District-name matching is available for all 28 Andhra Pradesh districts; map rendering and notifications remain future work.

### Telugu speech model attribution

Telugu speech playback uses [`ravivarmapatturi/vayyuedge-mms-tts-tel-onnx`](https://huggingface.co/ravivarmapatturi/vayyuedge-mms-tts-tel-onnx), an ONNX export based on [`facebook/mms-tts-tel`](https://huggingface.co/facebook/mms-tts-tel). The model is licensed under [CC-BY-NC-4.0](https://creativecommons.org/licenses/by-nc/4.0/). Attribution: model by **Ravi Varma Patturi**, based on **Meta AI's MMS-TTS Telugu model**. The non-commercial restriction applies; this feature is intended for non-commercial use only.

The model weights (about 109 MiB) are downloaded from Hugging Face only when a user explicitly requests Telugu speech and are cached by the browser where supported. Telugu answer text and generated audio are processed locally and are not sent to a TTS service or CivicSignal backend.

## Requirements

- Node.js 20.19+ or 22.12+ (Node 24 is supported)
- npm 10+

## Run locally

1. Open a terminal in the project root.
2. Install root and frontend dependencies: `npm.cmd install` (PowerShell) or `npm install` (macOS/Linux).
3. Install backend dependencies: `cd server`, then `npm.cmd install` in PowerShell (or `npm install`); return to the project root with `cd ..`.
4. Copy `.env.example` to `server/.env` and fill in the Atlas URI and a random JWT secret (see **MongoDB Atlas and environment setup** below).
5. Install the local OCR models and verify them (PowerShell):

   ```powershell
   npm.cmd --prefix server run ocr:setup
   npm.cmd --prefix server run ocr:verify
   ```

6. Start the frontend and backend in separate terminals. In the project root run `npm.cmd run dev:client`; in a second terminal run `npm.cmd run dev:server`.
7. Open the Vite URL, usually `http://localhost:5173`.
8. The API health check is available at `http://localhost:4000/api/health` and through the Vite proxy at `http://localhost:5173/api/health`.

To create a production frontend build, use `npm.cmd run build`. To run backend tests, use `npm.cmd test` from the project root.

## Current implementation

- Language selection switches between English and Telugu and persists in browser storage.
- The dashboard remains an honest empty state; notice upload/details, an owner-private uploaded-notice list, district preferences, and the notice mention list are active. Parameterized notice-detail routes are not shown as ordinary navigation links. No fictional government notices are shown.
- Authentication and preferences are served by the Express API; the public health endpoint remains available. Users can select supported Andhra Pradesh districts, which are saved through the existing preferences API.
- District matching requires a supported district name or curated alias in the notice's cited evidence and preserves the evidence quote and page number. The 28-district registry uses stable CivicSignal application IDs, not LGD district codes; Polavaram and Markapuram carry RBI working-code source metadata only. Results say when a district is mentioned, unresolved, unknown, or not explicitly listed; omission is not treated as proof of no impact.
- The impact page is a text-evidence list, not a map. No coordinates or district geometries are used; Leaflet display remains deferred until a government boundary dataset's date, district names, and attribution can be verified.
- Signed-in users can upload PDF, JPG, and PNG documents (10 MB maximum by default). The API checks declared type, file signature, PDF page count, and image dimensions, writes files to GridFS by stream, and creates a queued job. Only the owner can read notice metadata or download the original document.
- Source checks are currently user-submitted candidate checks against the Andhra Pradesh Gazette only. `POST /api/v1/notices/:id/verify-source` accepts a Gazette PDF URL on the exact `apegazette.cgg.gov.in` host via `/uploadGazette_view?filePath=...` or `/preview.do?fileName=...`, plus the source publication date. It compares title, issuer, notice date, and publication date against the uploaded notice and official PDF text. The path/file token is treated as opaque and is not decoded for authenticity claims. The check is bounded and owner-protected; `no_match` applies to the submitted candidate, and even `match_found` does not change the notice's `unverified` authenticity status. Automated Gazette search and other department domains are not yet supported.
- The authenticated `POST /api/v1/assistant/ask` endpoint accepts English (`en`) or Telugu (`te`) text questions in `current` (with `noticeId`) or `all` mode. It uses only the signed-in user's completed extracted pages, limits context to 10 notices and 60,000 characters, and returns validated page citations tied to notice IDs. Answers are labeled AI-generated, unsupported questions receive a fixed no-answer response, and source notices remain unverified. Speech input/output and frontend assistant wiring are not part of this backend step.
- Upload limits use `UPLOAD_MAX_FILE_SIZE_BYTES`, `UPLOAD_MAX_PDF_PAGES`, and `UPLOAD_MAX_IMAGE_PIXELS`. `GRIDFS_BUCKET_NAME` selects the GridFS bucket. Temporary upload files are stored under the OS temporary directory and removed after handling; `UPLOAD_TEMP_DIR` can override it.
- The worker starts after MongoDB connects, atomically claims queued jobs with a processing token and lease, and recovers expired work with a three-attempt default bound. It extracts selectable PDF text page by page and uses Tesseract.js OCR for images and scanned PDF pages. Results appear only when extraction completes. Failed jobs can be retried by their owner while attempts remain.
- OCR uses only local English (`eng`) and Telugu (`tel`) Tesseract trained data. `npm.cmd --prefix server run ocr:setup` downloads the pinned `tessdata_fast` 4.1.0 files and checks their SHA-256 hashes. The model files and Tesseract cache are ignored by Git. If you install the files elsewhere, set `OCR_TESSDATA_DIR` in `server/.env`.
- If the trained data is missing, the API still starts, but the processing worker stays disabled and queued jobs wait until you install the models and restart the server.

### OCR and processing checks

The setup and verification commands generate English and Telugu sample text locally; no external OCR service is used.

```powershell
npm.cmd --prefix server run ocr:setup
npm.cmd --prefix server run ocr:verify
npm.cmd --prefix server run test:ocr
npm.cmd test
npm.cmd --prefix client test
npm.cmd run build
```

The backend test suite uses an isolated in-memory MongoDB database. OCR tests expect the trained-data files installed by `ocr:setup`.

## MongoDB Atlas and environment setup

1. In MongoDB Atlas, create a project and a cluster (a free tier is sufficient for development).
2. Open **Security → Database & Network Access → IP Access List** and add your current development IP. Avoid allowing access from every IP (`0.0.0.0/0`) for a normal development setup.
3. Under **Database Access**, create an application database user with a strong password. This is separate from your Atlas website login. Grant only the required read/write access for the CivicSignal database.
4. In the cluster view, choose **Connect → Drivers**, select Node.js, and copy the connection string. Replace the username/password placeholders. URL-encode special characters in the database password.
5. Copy `.env.example` to `server/.env` using PowerShell:

   ```powershell
   Copy-Item .env.example server/.env
   ```

6. Edit `server/.env` in VS Code. Set `MONGODB_URI` to the connection string and `MONGODB_DB_NAME` to `civicsignal`. Replace `JWT_SECRET` with a locally generated random value. For example, in PowerShell:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   Paste that value into `server/.env` only. Never paste it into source code, `.env.example`, or chat, and do not commit `server/.env`.

7. Keep `CLIENT_ORIGIN=http://localhost:5173` for local development. The API validates browser origins and uses credentialed CORS for that exact origin.

The server will not start listening until it has connected to the configured database. Its logs intentionally omit connection strings and database credentials.

### Cookie and cross-origin deployment notes

Access JWTs are short-lived (15 minutes by default) and are sent only in an HTTP-only cookie. Preference updates also require a CSRF cookie/header pair and an allowed `Origin`. Local development works through the Vite proxy or the configured local client origin.

For deployment, prefer frontend and API custom domains under the same registrable site (for example `app.example.com` and `api.example.com`) and set `CLIENT_ORIGIN` to the exact frontend origin. The current cookies use `SameSite=Lax`; unrelated hosting domains such as a default Vercel domain and a default Render domain are cross-site, so browsers may withhold these cookies. Supporting genuinely cross-site hosting would require `SameSite=None; Secure`, exact credentialed CORS configuration, and acceptance that some browsers block third-party cookies. A same-site custom-domain setup is the recommended deployment path.

## Authentication API smoke test

State-changing routes require `Origin: http://localhost:5173` plus a valid CSRF cookie/header pair. With the API running, these PowerShell examples register and log in with a cookie session. Use a non-real development password and never commit it.

```powershell
$origin = 'http://localhost:5173'
$body = @{ email = 'citizen@example.test'; password = 'Local-test-pass-123!'; languagePreference = 'en-IN' } | ConvertTo-Json
$csrfBootstrap = Invoke-RestMethod -Method Get -Uri 'http://localhost:4000/api/v1/auth/csrf' -Headers @{ Origin = $origin } -SessionVariable session
$register = Invoke-RestMethod -Method Post -Uri 'http://localhost:4000/api/v1/auth/register' -Headers @{ Origin = $origin; 'X-CSRF-Token' = $csrfBootstrap.csrfToken } -ContentType 'application/json' -Body $body -WebSession $session
$csrf = $register.csrfToken
$me = Invoke-RestMethod -Method Get -Uri 'http://localhost:4000/api/v1/users/me' -WebSession $session
$prefs = @{ languagePreference = 'te-IN' } | ConvertTo-Json
Invoke-RestMethod -Method Patch -Uri 'http://localhost:4000/api/v1/users/preferences' -Headers @{ Origin = $origin; 'X-CSRF-Token' = $csrf } -ContentType 'application/json' -Body $prefs -WebSession $session
```

For login, create a fresh web session by first calling `GET /api/v1/auth/csrf` with `-SessionVariable session`, then send that response token in `X-CSRF-Token` with the trusted `Origin` header to `/api/v1/auth/login`. Use the login response `csrfToken` for later preference updates. The browser forms perform this bootstrap automatically. Automated backend tests use `mongodb-memory-server` and do not use your Atlas database.

Run the frontend authentication form tests with `npm.cmd --prefix client test` from the project root. They mock the API and do not contact Atlas.
