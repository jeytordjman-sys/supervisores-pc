// Ligação da app ao servidor. Copie para config.js e preencha UMA das duas opções.
// Sem config.js (ou com valores vazios) a app corre em modo demo, só com dados de exemplo neste browser.

// Opção A — Google Sheets + Apps Script (gratuito, recomendado): URL da implementação «App Web», termina em /exec.
// Ver google-sheets/README-instalacao.md
window.GAS_CONFIG = {
  url: "https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec"
};

// Opção B — Supabase (ver supabase/README-instalacao.md). A chave «anon» é pública por desenho;
// NUNCA colocar aqui a chave service_role.
// window.SUPABASE_CONFIG = { url: "https://xxxxxxxxxxxxxxxxxxxx.supabase.co", anonKey: "eyJ..." };
