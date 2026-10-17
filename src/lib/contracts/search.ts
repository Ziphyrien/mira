export type SearchSource = {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  favicon?: string;
};
export type SearchActivity = {
  id: string;
  query: string;
  status: "running" | "done" | "error";
  sources: SearchSource[];
  error?: string;
};
