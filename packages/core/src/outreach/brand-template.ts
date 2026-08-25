export const CONTENT_PLACEHOLDER = "{{content}}";

export const BRAND_TEMPLATE_LIGHT_CSS = `
  .riko-body { background: #ffffff !important; }
  .riko-brand { color: #111111 !important; }
  .riko-content { color: #1f2430 !important; }
  .riko-footer { color: #9ca3af !important; border-top-color: #e5e7eb !important; }
  .riko-btn { background: #111111 !important; }
  .riko-btn-label { color: #ffffff !important; }
  .riko-link { color: #2563eb !important; }
  .riko-unsub { color: #9ca3af !important; }
  .riko-address { color: #8b94a3 !important; }
`;

export const BRAND_TEMPLATE_DARK_CSS = `
  .riko-body { background: #101319 !important; }
  .riko-brand { color: #f2f4f7 !important; }
  .riko-content { color: #ced4de !important; }
  .riko-footer { color: #8b94a3 !important; border-top-color: #262c36 !important; }
  .riko-btn { background: #f2f4f7 !important; }
  .riko-btn-label { color: #111111 !important; }
  .riko-link { color: #7ab3ff !important; }
  .riko-unsub { color: #8b94a3 !important; }
  .riko-address { color: #8b94a3 !important; }
`;

export const DEFAULT_BRAND_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <style>
      @media (prefers-color-scheme: dark) {
${BRAND_TEMPLATE_DARK_CSS}
      }
    </style>
  </head>
  <body class="riko-body" style="margin:0;padding:32px 16px;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
      <tr>
        <td class="riko-brand" style="padding:0 0 24px;font-size:14px;font-weight:600;letter-spacing:0.01em;color:#111111;">
          {{merchant_name}}
        </td>
      </tr>
      <tr>
        <td class="riko-content" style="font-size:15px;line-height:1.7;color:#1f2430;text-wrap:pretty;word-wrap:break-word;">
          {{content}}
        </td>
      </tr>
      <tr>
        <td class="riko-footer" style="padding:40px 0 0;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#9ca3af;">
          Sent by {{merchant_name}} regarding your subscription payment.
        </td>
      </tr>
    </table>
  </body>
</html>`;

export interface BrandTemplateVars {
  content: string;
  merchantName: string;
}

export interface TemplateValidation {
  valid: boolean;
  errors: string[];
}

export function validateBrandTemplate(template: string): TemplateValidation {
  const errors: string[] = [];

  if (!template.includes(CONTENT_PLACEHOLDER)) {
    errors.push(`Template must contain ${CONTENT_PLACEHOLDER} where the message body goes.`);
  }
  if (/<script\b/i.test(template)) {
    errors.push("Template must not contain <script> tags; mail clients strip them and they trip spam filters.");
  }
  if (/\son\w+\s*=/i.test(template)) {
    errors.push("Template must not contain inline event handlers such as onclick.");
  }
  if (template.length > 50_000) {
    errors.push("Template must be under 50,000 characters.");
  }

  return { valid: errors.length === 0, errors };
}

export function renderBrandTemplate(template: string | null, vars: BrandTemplateVars): string {
  const source = template && template.includes(CONTENT_PLACEHOLDER) ? template : DEFAULT_BRAND_TEMPLATE;
  return source
    .split(CONTENT_PLACEHOLDER)
    .join(vars.content)
    .split("{{merchant_name}}")
    .join(escapeHtml(vars.merchantName));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
