import express, { Application } from 'express';
import { loadExpress } from '@/loaders/express.loader';

export function createApp(): Application {
  const app = express();
  loadExpress(app);
  return app;
}
