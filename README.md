# Ava Chat System Backend

A secure, production-ready backend for the Ava Chat System with AI integration, support ticketing, and comprehensive security measures.

## 🚀 Features

### Core Functionality
- **Real-time Chat**: WebSocket-based messaging system
- **AI Integration**: OpenAI-powered chat responses and message classification
- **Support System**: Human support with conversation assignment
- **Ticket Management**: Jira integration for issue tracking
- **Voice Messages**: Speech-to-text conversion using Whisper
- **File Uploads**: Secure audio file handling

### Security Features
- **Rate Limiting**: Multiple tiers of protection against abuse
- **Input Validation**: Comprehensive sanitization and validation
- **Authentication**: JWT-based auth with role-based access control
- **Environment Validation**: Startup validation of all configurations
- **Security Headers**: Complete set of security headers
- **File Upload Security**: MIME type validation and size limits
- **Logging & Monitoring**: Security event logging and monitoring

## 🛡️ Security

This application has been hardened for production use and penetration testing. See [SECURITY.md](./SECURITY.md) for detailed security documentation.

### Security Highlights
- ✅ OWASP Top 10 protection
- ✅ Rate limiting and DDoS protection
- ✅ Input sanitization and validation
- ✅ Secure authentication and authorization
- ✅ Comprehensive security headers
- ✅ Environment variable validation
- ✅ Security monitoring and logging

## 📋 Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account and project
- OpenAI API key (optional)
- Jira account (optional)

## 🔧 Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd Backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment setup**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Build the application**:
   ```bash
   npm run build
   ```

5. **Start the server**:
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## ⚙️ Configuration

### Required Environment Variables

```bash
# Security
JWT_SECRET=your-32-character-secret-key
NODE_ENV=production

# Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Server
PORT=3000
FRONTEND_URL=https://yourdomain.com
```

### Optional Services

```bash
# AI Features
OPENAI_API_KEY=sk-your-openai-key

# Support Ticketing
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_USERNAME=your-email@domain.com
JIRA_API_TOKEN=your-jira-token
JIRA_PROJECT_KEY=PROJECT

# Speech-to-Text
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
GOOGLE_CLOUD_PROJECT_ID=your-project-id
```

See [.env.example](./.env.example) for complete configuration options.

## 🏗️ Architecture

### API Endpoints

#### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - User logout

#### Chat System
- `POST /api/chat/start-conversation` - Start new conversation
- `POST /api/chat/send-message` - Send message (with AI processing)
- `POST /api/chat/conversations/:id/send-message` - Send to existing conversation
- `GET /api/chat/conversations` - Get user conversations
- `GET /api/chat/conversation/:id/messages` - Get conversation messages

#### Support System
- `GET /api/support/conversations` - Get support dashboard
- `POST /api/support/conversations/:id/assign` - Assign conversation
- `POST /api/support/conversations/:id/close` - Close conversation
- `POST /api/support/conversations/:id/messages` - Send support message

#### Jira Integration
- `GET /api/support/jira-tickets/:id` - Get ticket details
- `PUT /api/support/jira-tickets/:id/status` - Update ticket status
- `POST /api/support/jira-tickets/:id/comments` - Add ticket comment

### Database Schema

The application uses Supabase with the following main tables:
- `profiles` - User profiles and roles
- `conversations` - Chat conversations
- `messages` - Individual messages
- Row Level Security (RLS) policies for data protection

## 🚀 Deployment

For production deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive instructions.

### Quick Production Setup

1. **Server Requirements**:
   - Ubuntu 20.04+ or similar
   - Node.js 18+
   - Nginx or Apache
   - SSL certificate

2. **Security Checklist**:
   - [ ] Strong JWT secret (32+ characters)
   - [ ] HTTPS enabled
   - [ ] Firewall configured
   - [ ] Rate limiting at proxy level
   - [ ] Environment variables secured
   - [ ] Monitoring enabled

3. **Process Management**:
   ```bash
   # Using PM2
   npm install -g pm2
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

## 🧪 Testing

### API Testing

Use the provided Postman collection: [POSTMAN_COLLECTION.md](./POSTMAN_COLLECTION.md)

### Security Testing

```bash
# Run security audit
npm audit

# Test rate limiting
for i in {1..20}; do curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/login; done

# Test input validation
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"invalid-email","password":"weak"}'
```

### Load Testing

```bash
# Install Apache Bench
sudo apt install apache2-utils

# Test performance
ab -n 1000 -c 10 http://localhost:3000/health
```

## 📊 Monitoring

### Application Monitoring
- PM2 monitoring dashboard
- Custom security event logging
- Performance metrics tracking
- Error rate monitoring

### Security Monitoring
- Failed authentication attempts
- Suspicious request patterns
- Rate limit violations
- File upload anomalies

## 🔍 Troubleshooting

### Common Issues

1. **Environment validation errors**:
   - Check all required environment variables
   - Ensure JWT secret is 32+ characters
   - Verify Supabase credentials

2. **Rate limiting issues**:
   - Check if legitimate traffic is being blocked
   - Adjust rate limits in security middleware
   - Whitelist known good IPs

3. **File upload failures**:
   - Verify upload directory permissions
   - Check file size limits
   - Ensure MIME type validation

### Debug Mode

```bash
# Enable debug logging
DEBUG=true npm run dev

# Check application logs
pm2 logs ava-chat-backend

# Monitor system resources
htop
```

## 📚 Documentation

- [Security Documentation](./SECURITY.md) - Comprehensive security guide
- [Deployment Guide](./DEPLOYMENT.md) - Production deployment instructions
- [API Documentation](./POSTMAN_COLLECTION.md) - Complete API reference

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run security tests
5. Submit a pull request

### Development Guidelines

- Follow security best practices
- Add input validation for new endpoints
- Update documentation for changes
- Test rate limiting and security measures

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For security issues, please email: security@company.com
For general support: support@company.com

---

**Built with security in mind** 🛡️
