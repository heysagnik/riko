export const CONTENT_PLACEHOLDER = "{{content}}";

export const DEFAULT_BRAND_TEMPLATE = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
      <tr>
        <td style="padding:0 0 24px;font-size:14px;font-weight:600;letter-spacing:0.01em;color:#111111;">
          {{merchant_name}}
        </td>
      </tr>
      <tr>
        <td style="font-size:15px;line-height:1.7;color:#1f2430;text-wrap:pretty;word-wrap:break-word;">
          {{content}}
        </td>
      </tr>
      <tr>
        <td style="padding:40px 0 0;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.6;color:#9ca3af;">
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
