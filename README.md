# Tsuchinoco E-commerce Store

A modern, full-featured e-commerce website built with Next.js, TypeScript, Tailwind CSS, Firebase, and Stripe.

## Features

- 🛍️ **Product Catalog** - Browse and search products with category filtering
- 🛒 **Shopping Cart** - Add/remove items with quantity controls
- 💳 **Checkout System** - Complete order forms with customer information
- 👨‍💼 **Admin Panel** - Manage products and view orders
- 🔥 **Firebase Integration** - Real-time database and authentication
- 💰 **Stripe Integration** - Secure payment processing
- 📱 **Responsive Design** - Mobile-first approach with Tailwind CSS
- ⚡ **Performance** - Built with Next.js 15 and optimized for speed

## Tech Stack

- **Frontend**: Next.js 15, TypeScript, Tailwind CSS
- **Backend**: Firebase (Firestore, Auth, Storage)
- **Payments**: Stripe
- **State Management**: React Hooks with localStorage persistence
- **Icons**: Lucide React
- **Deployment**: Firebase Hosting (static export)

## Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (v18 or higher)
- npm or yarn
- Git

## Quick Start

### 1. Clone and Install

```bash
# Clone the repository
git clone <your-repo-url>
cd ecommerce-store

# Install dependencies
npm install
```

### 2. Environment Setup

Copy the environment template and fill in your credentials:

```bash
# Copy the template
cp env.template .env.local

# Edit .env.local with your actual values
```

**Required Environment Variables:**

```env
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Stripe Configuration
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
```

### 3. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Enable these services:
   - **Authentication**: Email/Password provider
   - **Firestore Database**: Start in test mode
   - **Storage**: Default settings
   - **Hosting**: Initialize later

4. Get your configuration:
   - Go to Project Settings → General → Your apps
   - Add a web app (if not exists)
   - Copy the config values to `.env.local`

5. Update Firebase project ID:
   ```bash
   # Edit .firebaserc
   {
     "projects": {
       "default": "your-actual-project-id"
     }
   }
   ```

### 4. Stripe Setup

1. Create a [Stripe account](https://stripe.com/)
2. Get API keys from Dashboard → Developers → API Keys
3. Add keys to `.env.local`

### 5. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the store.

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── admin/             # Admin panel routes
│   ├── cart/              # Shopping cart
│   ├── checkout/          # Checkout process
│   ├── products/          # Product catalog
│   └── api/               # API routes
├── components/             # React components
│   ├── ui/                # Reusable UI components
│   ├── admin/             # Admin-specific components
│   ├── cart/              # Cart components
│   └── products/          # Product components
├── hooks/                  # Custom React hooks
├── lib/                    # Utility libraries
└── types/                  # TypeScript type definitions
```

## Development

### Adding Products

Currently, products need to be added manually to Firebase Firestore. The structure should be:

```typescript
{
  name: "Product Name",
  description: "Product description",
  price: 2999, // Price in cents
  imageUrl: "https://example.com/image.jpg",
  category: "electronics",
  stock: 10,
  createdAt: Timestamp.now()
}
```

### Customizing Styles

The project uses Tailwind CSS for styling. You can customize:
- Colors in `tailwind.config.js`
- Global styles in `src/app/globals.css`
- Component-specific styles in individual component files

### Adding New Features

1. **New Pages**: Create new directories in `src/app/`
2. **New Components**: Add to appropriate `src/components/` subdirectory
3. **New Hooks**: Create in `src/hooks/`
4. **New Types**: Extend `src/types/index.ts`

## Deployment

### Firebase Hosting

1. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Build and deploy:
   ```bash
   # Build for production
   npm run build

   # Deploy to Firebase
   firebase deploy
   ```

### Vercel (Alternative)

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy automatically on push

## Security

### Firestore Rules

The project includes basic security rules in `firestore.rules`:
- Products: Read for all, write for authenticated admins
- Orders: Read/write for authenticated users (own orders)
- Users: Read/write own data

### Storage Rules

Storage rules in `storage.rules`:
- Product images: Read for all, write for admins
- User uploads: Read/write for own files

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Common Issues

**Build Errors:**
- Ensure all environment variables are set
- Check Firebase configuration
- Verify all dependencies are installed

**Database Connection:**
- Check Firestore rules allow operations
- Verify Firebase config in production
- Ensure project ID matches

**Payment Issues:**
- Verify Stripe keys are correct
- Check Stripe webhook configuration
- Ensure test mode is enabled for development

### Getting Help

- Check the [Firebase documentation](https://firebase.google.com/docs)
- Review [Stripe documentation](https://stripe.com/docs)
- Open an issue in this repository

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- Styled with [Tailwind CSS](https://tailwindcss.com/)
- Powered by [Firebase](https://firebase.google.com/)
- Payments by [Stripe](https://stripe.com/)
