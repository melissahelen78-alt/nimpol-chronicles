import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const supabaseUrl = "https://ilpjjfgslfuqffxvlzuf.supabase.co";
export const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlscGpqZmdzbGZ1cWZmeHZsenVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNjYxODIsImV4cCI6MjA5ODY0MjE4Mn0.VUDF6AXLmCpLGLAjjjTkkraycs0VAxqd0GkFfcBSZL4";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
