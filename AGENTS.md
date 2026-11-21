# CivicSignal - Codex Development Instructions

## 1. Project Requirements
- Always read `SPEC.md` before making changes.
- Treat `SPEC.md` as the single source of truth.
- Build CivicSignal according to the requirements in `SPEC.md`.

## 2. Development Approach
- Work in small, clearly defined phases.
- Before implementing a phase, inspect the existing project and explain your plan.
- Do not implement all features at once.
- Write clean, modular, maintainable code.
- Do not overwrite existing work without explaining why.
- Ask for approval before moving to the next phase.

## 3. Technology Stack
- Frontend: React, Vite, Tailwind CSS.
- Backend: Node.js, Express.
- Database: MongoDB Atlas, Mongoose.
- AI: Google Gemini API.
- Validation: Zod.
- Maps: Leaflet and OpenStreetMap.

## 4. Language Requirements
- Support English and Telugu only.
- Allow users to switch languages at any time.
- Use separate translation files for English and Telugu.
- Support English and Telugu voice assistance.
- Never use Tamil.
- Do not hardcode user-facing text throughout components.

## 5. AI and Data Reliability
- Use structured JSON output from Gemini.
- Validate AI-generated data before saving it.
- Keep original source documents and evidence references.
- Never invent government notices or present demo data as real.
- Keep AI confidence separate from source authenticity.
- Do not claim an area is unaffected just because it is not mentioned.

## 6. Security
- Keep API keys in backend environment variables.
- Never expose Gemini API keys in frontend code.
- Validate uploaded files and their sizes.
- Never commit `.env` files or secrets to GitHub.

## 7. Testing
- Add tests for important backend and frontend functionality.
- Run relevant tests after each implementation phase.
- Fix errors before reporting a phase as complete.

## 8. Working Process
For every phase:
1. Read `SPEC.md` and this file.
2. Inspect the existing code.
3. Explain the implementation plan.
4. Wait for my approval.
5. Implement only the approved phase.
6. Run tests and report results.
7. Wait for my approval before continuing.