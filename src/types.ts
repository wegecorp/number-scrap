export type Source = 'instagram' | 'google-maps' | 'website' | 'forum';

export type Candidate = {
  source: Source;
  handle?: string;
  name: string;
  city?: string;
  bio?: string;
  website?: string;
  url?: string;
  phone?: string;
  rawPhone?: string;
  email?: string;
  meta?: Record<string, unknown>;
};

export type ExpandedQuery = {
  sport: string;
  targetType: string;
  city: string;
  googleQueries: string[];
  hashtags: string[];
  synonyms: string[];
  tooBroad?: boolean;
};

export type LeadScore = {
  id: number;
  score: number;
  reason: string;
  segment: string;
  templateId: string;
};

export type LeadRecord = {
  id: number;
  source: Source;
  handle: string | null;
  name: string;
  city: string | null;
  bio: string | null;
  website: string | null;
  phone: string | null;
  raw_phone: string | null;
  email: string | null;
  url: string | null;
  meta: string | null;
  suggested_message: string | null;
  contacted_at: string | null;
  created_at: string;
  updated_at: string;
};
