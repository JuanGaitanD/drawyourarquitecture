import type { ContentRepo } from '@/application/ports';
import { createContentRepo } from './contentRepo';
import { loadFirestore } from './firestore';

export const contentRepo: ContentRepo = createContentRepo(loadFirestore);
