import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes.js';
import healthRoutes from './routes/health.routes.js';
import userRoutes from './routes/users.routes.js';
import noticeRoutes from './routes/notices.routes.js';
import areaRoutes from './routes/areas.routes.js';
import assistantRoutes from './routes/assistant.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { config } from './config/env.js';

const app = express();

app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.clientOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/notices', noticeRoutes);
app.use('/api/v1/areas', areaRoutes);
app.use('/api/v1/assistant', assistantRoutes);
app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use(errorHandler);

export default app;
