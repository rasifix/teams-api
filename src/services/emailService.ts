import * as brevo from '@getbrevo/brevo';

// Configuration from environment variables
const getBrevoConfig = () => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'noreply@teams-api.com';
  const senderName = process.env.BREVO_SENDER_NAME || 'Teams API';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not defined in environment variables');
  }
  
  return { apiKey, senderEmail, senderName, frontendUrl };
};

// Initialize Brevo API client
let apiInstance: brevo.TransactionalEmailsApi | null = null;

const getApiInstance = (): brevo.TransactionalEmailsApi => {
  if (!apiInstance) {
    const { apiKey } = getBrevoConfig();
    console.log("apiKey:", apiKey);
    apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);
  }
  return apiInstance;
};

export interface SendPasswordResetEmailParams {
  toEmail: string;
  resetToken: string;
}

export const sendPasswordResetEmail = async (
  params: SendPasswordResetEmailParams
): Promise<void> => {
  try {
    const { senderEmail, senderName, frontendUrl } = getBrevoConfig();
    const { toEmail, resetToken } = params;
    
    // Construct reset URL
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(toEmail)}`;
    
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    
    sendSmtpEmail.sender = {
      email: senderEmail,
      name: senderName
    };
    
    sendSmtpEmail.to = [{ email: toEmail }];
    
    sendSmtpEmail.subject = 'Reset Your Password - Teams API';
    
    sendSmtpEmail.htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Your Password</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
            <h1 style="color: #2c3e50; margin-top: 0;">Reset Your Password</h1>
            <p>You requested to reset your password for your Teams API account.</p>
            <p>Click the button below to reset your password. This link will expire in 1 hour.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Reset Password
              </a>
            </div>
            <p style="color: #6c757d; font-size: 14px;">
              Or copy and paste this link into your browser:<br>
              <a href="${resetUrl}" style="color: #007bff; word-break: break-all;">${resetUrl}</a>
            </p>
          </div>
          <div style="color: #6c757d; font-size: 12px; border-top: 1px solid #dee2e6; padding-top: 20px;">
            <p><strong>Security Notice:</strong></p>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>This link will expire in 1 hour</li>
              <li>If you didn't request this password reset, you can safely ignore this email</li>
              <li>Your password will not change unless you click the link above and set a new password</li>
            </ul>
            <p style="margin-top: 20px;">
              This is an automated email. Please do not reply to this message.
            </p>
          </div>
        </body>
      </html>
    `;
    
    sendSmtpEmail.textContent = `
Reset Your Password

You requested to reset your password for your Teams API account.

Click the link below to reset your password. This link will expire in 1 hour:
${resetUrl}

Security Notice:
- This link will expire in 1 hour
- If you didn't request this password reset, you can safely ignore this email
- Your password will not change unless you click the link above and set a new password

This is an automated email. Please do not reply to this message.
    `;
    
    const api = getApiInstance();
    await api.sendTransacEmail(sendSmtpEmail);
    
    console.log(`Password reset email sent to: ${toEmail}`);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    throw new Error('Failed to send password reset email');
  }
};

export const emailService = {
  sendPasswordResetEmail
};
