import { Request, Response } from 'express';
import { getCategoryCatalog } from '../data/sfvCategories';

export const getSfvCategories = (_req: Request, res: Response): void => {
  res.json(getCategoryCatalog());
};
