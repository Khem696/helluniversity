# Hell University - Cultural House

A modern, SEO-optimized Next.js application for Hell University, a cultural house dedicated to promoting creative expression and community engagement.

## 🚀 Features

### SEO & Performance
- **Server-Side Rendering (SSR)** with Next.js 14
- **Static Site Generation (SSG)** for optimal performance
- **Comprehensive SEO metadata** with Open Graph and Twitter cards
- **Structured data** (JSON-LD) for rich snippets
- **Automatic sitemap generation**
- **Image optimization** with Next.js Image component
- **Lazy loading** for improved performance

### Progressive Web App (PWA)
- **Offline functionality** with service workers
- **Install prompt** for mobile devices
- **App-like experience** on mobile
- **Caching strategies** for optimal performance

### Analytics & Tracking
- **Vercel Analytics** for performance monitoring
- **Google Analytics** integration
- **Custom event tracking** for user interactions
- **Performance monitoring** with Core Web Vitals

### UI/UX
- **Responsive design** with Tailwind CSS
- **Accessible components** with Radix UI
- **Smooth animations** and transitions
- **Dark mode support** (ready for implementation)
- **Form validation** with React Hook Form and Zod

## 🛠️ Tech Stack

- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Radix UI
- **Forms**: React Hook Form with Zod validation
- **Icons**: Lucide React
- **Analytics**: Vercel Analytics + Google Analytics
- **PWA**: next-pwa
- **Deployment**: Vercel (recommended)

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd kade-studio-web-application
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env.local
   ```
   
   Update the following variables:
   - `NEXT_PUBLIC_GA_ID`: Your Google Analytics tracking ID
   - `NEXT_PUBLIC_SITE_URL`: Your production URL

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🚀 Deployment

### Vercel (Recommended)
1. Push your code to GitHub
2. Connect your repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy automatically on every push

### Other Platforms
The app can be deployed to any platform that supports Next.js:
- Netlify
- AWS Amplify
- Railway
- DigitalOcean App Platform

## 📊 Performance

### Core Web Vitals
- **LCP (Largest Contentful Paint)**: < 2.5s
- **FID (First Input Delay)**: < 100ms
- **CLS (Cumulative Layout Shift)**: < 0.1

### Optimization Features
- Image optimization with WebP/AVIF formats
- Code splitting and lazy loading
- Service worker caching
- Bundle analysis with `npm run analyze`

## 🔧 Configuration

### SEO Configuration
Update `app/layout.tsx` to customize:
- Site metadata
- Open Graph tags
- Twitter cards
- Structured data

### Analytics
Configure analytics in:
- `app/layout.tsx` for Google Analytics
- `src/lib/analytics.ts` for custom events

### PWA Configuration
Customize PWA settings in:
- `public/site.webmanifest`
- `next.config.js` for service worker settings

## 📱 PWA Features

### Installation
- Automatic install prompt on supported devices
- Custom install banner with dismiss functionality
- Offline functionality with cached resources

### Caching Strategy
- **Static assets**: Cache first
- **API responses**: Stale while revalidate
- **Images**: Optimized with WebP format
- **Fonts**: Long-term caching

## 🎨 Customization

### Styling
- Modify `tailwind.config.js` for theme customization
- Update CSS variables in `app/globals.css`
- Customize component styles in individual files

### Components
- All components are in `src/components/`
- UI components use Radix UI primitives
- Custom components follow the established patterns

## 📈 Analytics & Monitoring

### Vercel Analytics
- Automatic Core Web Vitals tracking
- Real-time performance monitoring
- User behavior analytics

### Google Analytics
- Page view tracking
- Custom event tracking
- Conversion tracking for form submissions

### Custom Events
Tracked events include:
- Form submissions
- Button clicks
- AI generator usage
- Scroll depth
- Time on page

## 🔍 SEO Features

### Meta Tags
- Dynamic title and description
- Open Graph tags for social sharing
- Twitter Card optimization
- Canonical URLs

### Structured Data
- Organization schema
- Local business schema
- Event schema
- Website schema

### Technical SEO
- Automatic sitemap generation
- Robots.txt configuration
- Image alt tags
- Semantic HTML structure

## 🚨 Troubleshooting

### Common Issues

1. **Build Errors**
   - Ensure all dependencies are installed
   - Check TypeScript errors
   - Verify environment variables

2. **PWA Issues**
   - Clear browser cache
   - Check service worker registration
   - Verify manifest file

3. **Analytics Issues**
   - Verify Google Analytics ID
   - Check network requests
   - Ensure proper event tracking

### Performance Issues
- Use `npm run analyze` to check bundle size
- Optimize images and assets
- Check Core Web Vitals in Google Search Console

## 📝 Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run analyze` - Analyze bundle size

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions:
- Create an issue on GitHub
- Contact: hello@helluniversity.com

---

Built with ❤️ for the creative community