export const CONTENT_PLACEHOLDER = "{{content}}";

export const DEFAULT_BRAND_TEMPLATE = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e7ec;border-radius:8px;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e4e7ec;font-size:15px;font-weight:600;color:#0f1115;">
          {{merchant_name}}
        </td>
      </tr>
      <tr>
        <td style="padding:24px;font-size:14px;line-height:1.6;color:#1f2430;">
          {{content}}
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px;border-top:1px solid #e4e7ec;font-size:12px;color:#8b94a3;">
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
