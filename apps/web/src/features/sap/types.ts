export interface SapSystem {
  id: string;
  code: string;
  name: string;
  ownerCustomerId: string | null;
  ownerName?: string;
  sapUrl: string;
  language: string;
  status: string;
  testStatus?: string | null;
  testMessage?: string | null;
  testedAt?: string | null;
  backendVersion?: string | null;
  rowVersion: string;
}
export interface SapRow {
  environment: string;
  systemId: string | null;
  client: string | null;
  username: string | null;
  language: string | null;
  passwordMode: string;
  hasPassword: boolean;
  rowVersion: string;
  passwordAction?: string;
  password?: string;
}
export interface Effective {
  environment: string;
  systemId: string | null;
  systemName: string | null;
  sapUrl: string | null;
  client: string | null;
  username: string | null;
  language: string;
  hasPassword: boolean;
  credentialReady: boolean;
  available: boolean;
  sources: Record<string, string>;
}
export interface SapView {
  projectId: string;
  projectName: string;
  readOnly: boolean;
  systems: SapSystem[];
  rows: SapRow[];
  defaults: SapRow[];
  effective: Effective[];
}
