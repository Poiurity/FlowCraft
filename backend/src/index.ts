import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import apiRouter from './routes/api';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use('/api', apiRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`FlowCraft backend running on http://localhost:${PORT}`);
});
