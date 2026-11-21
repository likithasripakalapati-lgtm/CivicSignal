# CivicSignal — Project Specification

**Tagline:** Your Neighbourhood. Your Language. Your Information.

**Telugu tagline:** మీ ప్రాంతం. మీ భాష. మీ సమాచారం.

## 1. Project Overview

CivicSignal is an AI-powered, bilingual, location-aware public information intelligence platform.

It transforms complex government notices, public announcements and official documents into simple, personalized and actionable information.

The application supports English and Telugu and includes text and voice interaction.

Its main objective is to ensure that citizens can understand public information, identify announcements affecting their neighbourhood and receive timely updates when official information changes.

## 2. Problem Statement

Government announcements are distributed across multiple websites, departmental portals, PDF documents and public notices.

Citizens often struggle to:

- Find relevant government announcements.
- Understand complicated official documents.
- Identify whether an announcement affects their location.
- Understand important dates and required actions.
- Access information in their preferred language.
- Identify changes in previously published notices.

CivicSignal addresses these problems through AI-based document intelligence, multilingual explanations, geographical impact analysis and proactive notifications.

## 3. Project Objectives

1. Make public information easier to understand.
2. Provide English and Telugu language support.
3. Extract meaningful information from government documents.
4. Identify affected geographical areas.
5. Detect changes between different notice versions.
6. Deliver relevant notifications to citizens.
7. Support voice-based accessibility.
8. Provide verifiable references to original sources.

## 4. Target Users

- Ordinary citizens.
- Students.
- Working professionals.
- Senior citizens.
- Rural communities.
- Community organizations.

## 5. Language Requirements

Supported languages:

- English (en-IN)
- Telugu (te-IN)

Requirements:

- Users can switch languages anytime.
- Language preference persists between sessions.
- All primary application screens support both languages.
- Government notices can be explained in simple English and Telugu.
- Original documents remain accessible in their original language.
- Voice input and speech output support both languages.
- Important dates, numbers, locations and instructions must remain consistent across translations.

## 6. Core Features

### 6.1 Smart Notice Intelligence

- Upload PDF, JPG and PNG documents.
- Extract text from digital PDFs.
- Use OCR for scanned documents.
- Identify document categories and departments.
- Extract dates, times, locations and citizen instructions.
- Generate structured JSON.
- Validate extracted information.
- Retain original documents and supporting evidence.

### 6.2 Bilingual Explanation Engine

- Generate English summaries.
- Generate Telugu summaries.
- Explain complex government terminology in simple language.
- Generate actionable instructions.
- Preserve important dates and numbers.
- Link explanations to supporting source text.

### 6.3 Hyperlocal Impact Intelligence

- Allow users to select their city, locality or ward.
- Extract affected locations from notices.
- Match locations against supported geographical boundaries.
- Display affected locations on an interactive map.
- Distinguish confirmed impact, possible impact and areas not explicitly listed.
- Never infer that an area is unaffected without sufficient geographical evidence.

### 6.4 Notice Change Detection

- Store multiple versions of a notice.
- Generate document hashes.
- Compare extracted information between versions.
- Detect changes in dates, times, locations and instructions.
- Display original and revised information.
- Generate bilingual change summaries.
- Notify affected users when relevant information changes.

### 6.5 Bilingual Voice Assistant

- Support English and Telugu speech input using local, in-browser transcription.
- Capture microphone audio only after an explicit user action; do not send recordings to CivicSignal servers or remote speech-recognition services.
- Download and cache the multilingual Whisper model in the browser where supported; show first-download and loading progress.
- Let users review and edit the transcript before submitting it.
- Answer questions using verified notice information.
- Speak English answers with browser speech synthesis when available.
- Generate Telugu speech locally in a Web Worker using Transformers.js and `naklitechie/mms-tts-te-ONNX`; load it only after the user presses Speak answer, and cache model files where supported.
- Keep answer text and generated audio in the browser. The first Telugu speech use downloads about 109 MiB of model weights; show bilingual progress and failure states.
- Stop generated audio immediately when the user presses Stop, submits another question, or leaves the assistant.
- Allow users to replay audio.
- Provide push-to-talk interaction.
- Avoid answering from unsupported assumptions.

### 6.6 Personalized Notifications

- Store preferred language.
- Store selected locations.
- Store notification category preferences.
- Generate relevant in-app alerts.
- Support browser push notifications as an advanced feature.
- Avoid sending duplicate notifications.
- Notify users about relevant notice revisions.

### 6.7 Source Verification

Every notice must retain:

- Original document or official URL.
- Source organization.
- Publication date, when available.
- Relevant page numbers.
- Supporting text.
- Last checked date.
- Verification status.
- Extraction confidence.

AI-generated information must never be presented as an authenticated government order without independent source verification.

### 6.8 Public Impact Dashboard

Display:

- Active notices.
- Upcoming public events.
- Recently revised announcements.
- Notice categories.
- Geographical distribution.
- Affected neighbourhoods.
- Source freshness.
- Notice history.

## 7. Technology Stack

Frontend:
- React
- Vite
- Tailwind CSS
- React Router
- Axios
- React Leaflet
- Recharts

Backend:
- Node.js
- Express.js
- REST APIs

Database:
- MongoDB Atlas
- Mongoose

AI:
- Google Gemini API
- Structured JSON extraction
- Bilingual explanation generation
- Grounded question answering

Document Processing:
- PDF.js or pdf-parse
- OCR for scanned documents

Voice:
- Local browser transcription with `@huggingface/transformers` and `onnx-community/whisper-tiny` for English and Telugu.
- English answer playback with browser speech synthesis; availability depends on the browser and installed voices.
- Local Telugu answer synthesis with `@huggingface/transformers`, ONNX Runtime, and `naklitechie/mms-tts-te-ONNX` in a Web Worker.

Maps:
- Leaflet
- OpenStreetMap
- GeoJSON

Validation and Testing:
- Zod
- Vitest
- Supertest

Deployment:
- Vercel frontend
- Render backend
- MongoDB Atlas database

## 8. System Architecture

Official Sources / Document Upload
→ Document Processing
→ PDF Extraction / OCR
→ Gemini AI Analysis
→ Structured Data Validation
→ Evidence Verification
→ Notice Version Management
→ Geographical Impact Matching
→ MongoDB Storage
→ English and Telugu Explanation Generation
→ Personalized Notifications
→ Interactive Citizen Dashboard

Voice requests follow a separate processing path:

Speech Input
→ Speech Transcription
→ Verified Notice Retrieval
→ AI Response Generation
→ Speech Synthesis
→ Citizen

## 9. Database Collections

- users
- areas
- sources
- notices
- noticeVersions
- events
- alerts
- processingJobs

All collections must use appropriate indexes and relationships.

## 10. Backend API Requirements

Authentication:
- POST /api/v1/auth/register
- POST /api/v1/auth/login

Notices:
- GET /api/v1/notices
- GET /api/v1/notices/:id
- POST /api/v1/notices/upload
- POST /api/v1/notices/:id/process
- GET /api/v1/notices/:id/versions
- POST /api/v1/notices/:id/compare

Locations:
- GET /api/v1/areas
- GET /api/v1/areas/:id/impact

Notifications:
- GET /api/v1/alerts
- PATCH /api/v1/users/preferences

Voice:
- POST /api/v1/assistant/ask

All APIs must validate input, handle errors and protect sensitive information.

## 11. User Interface Pages

1. Landing Page
2. Authentication Pages
3. Citizen Dashboard
4. Notice Upload Page
5. Notice Details Page
6. Interactive Impact Map
7. Notification Centre
8. Voice Assistant Interface
9. User Settings
10. Source and Notice History

## 12. Security and Privacy

- Store password hashes, never plain-text passwords.
- Keep AI API keys on the backend.
- Validate file types and file sizes.
- Restrict document upload access.
- Protect APIs with authentication and authorization.
- Avoid storing unnecessary personal information.
- Obtain consent before using microphone input.
- Do not expose private user location information.
- Never send private documents to public sources.
- Maintain source and processing audit records.

## 13. Reliability Requirements

- Handle unavailable AI services.
- Handle invalid or unreadable documents.
- Prevent duplicate notice processing.
- Retry transient processing failures safely.
- Display processing status.
- Preserve original source documents.
- Distinguish uncertain geographical matches.
- Prevent unsupported claims.
- Handle translation and voice service failures gracefully.

## 14. Development Phases

Phase 1: Project foundation and UI.

Phase 2: Database and authentication.

Phase 3: Document upload and extraction.

Phase 4: Gemini notice intelligence.

Phase 5: English and Telugu explanations.

Phase 6: Geographical impact mapping.

Phase 7: Notice version comparison.

Phase 8: Voice assistant.

Phase 9: Notification engine.

Phase 10: Testing and deployment.

Phase 11: Documentation and hackathon presentation.

## 15. Acceptance Criteria

The project is considered ready for demonstration when:

- A citizen can register and log in.
- A citizen can select English or Telugu.
- A notice can be uploaded.
- The system extracts relevant information.
- Extracted information is validated against the document.
- Both English and Telugu explanations are generated.
- A citizen can select a supported geographical area.
- The application can display notice impact on a map.
- A revised notice can be compared with its earlier version.
- The application can identify changed information.
- Relevant in-app alerts are generated.
- Voice input and output work in both supported languages.
- Original documents and source references remain accessible.
- The application handles invalid documents and AI failures gracefully.

## 16. Project Scope

The first release focuses on a limited, configurable pilot geography and a curated set of official public-information sources.

It does not attempt to replace government portals, directly resolve civic complaints, make government decisions or submit applications on behalf of citizens.

Automatic monitoring, wider geographic coverage and additional notification channels can be introduced after the core system is reliable.

## 17. Unique Innovation

CivicSignal combines four major capabilities:

1. AI-powered government notice understanding.
2. Personalized geographical impact identification. 
3. English and Telugu public information accessibility.
4. Automatic detection of changes in previously published notices.

Its defining capability is proactively bringing verified, relevant public information to citizens instead of requiring citizens to search for it themselves.

## 18. Final Vision

CivicSignal aims to make public information understandable, accessible and actionable for every citizen, regardless of language or technical knowledge.

It transforms government information from complicated documents into meaningful knowledge that helps people prepare, respond and make informed decisions.