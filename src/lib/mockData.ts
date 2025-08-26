import { Product } from '@/types';

export const mockProducts: Product[] = [
  {
    id: '1',
    name: 'Wireless Bluetooth Headphones',
    description: 'High-quality wireless headphones with noise cancellation and long battery life.',
    price: 12999, // $129.99
    imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=400&fit=crop',
    category: 'electronics',
    stock: 25,
    createdAt: new Date('2024-01-15')
  },
  {
    id: '2',
    name: 'Smart Fitness Watch',
    description: 'Track your fitness goals with this advanced smartwatch featuring heart rate monitoring.',
    price: 19999, // $199.99
    imageUrl: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&h=400&fit=crop',
    category: 'electronics',
    stock: 15,
    createdAt: new Date('2024-01-20')
  },
  {
    id: '3',
    name: 'Organic Cotton T-Shirt',
    description: 'Comfortable and eco-friendly cotton t-shirt available in multiple colors.',
    price: 2999, // $29.99
    imageUrl: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&h=400&fit=crop',
    category: 'clothing',
    stock: 50,
    createdAt: new Date('2024-01-10')
  },
  {
    id: '4',
    name: 'Stainless Steel Water Bottle',
    description: 'Keep your drinks cold for 24 hours with this durable insulated water bottle.',
    price: 2499, // $24.99
    imageUrl: 'https://images.unsplash.com/photo-1602143407151-7111542de6e8?w=400&h=400&fit=crop',
    category: 'home',
    stock: 30,
    createdAt: new Date('2024-01-25')
  },
  {
    id: '5',
    name: 'Professional Camera Lens',
    description: 'High-performance camera lens perfect for portrait and landscape photography.',
    price: 89999, // $899.99
    imageUrl: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=400&h=400&fit=crop',
    category: 'electronics',
    stock: 8,
    createdAt: new Date('2024-01-30')
  },
  {
    id: '6',
    name: 'Yoga Mat Premium',
    description: 'Non-slip yoga mat made from eco-friendly materials for your daily practice.',
    price: 3999, // $39.99
    imageUrl: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=400&h=400&fit=crop',
    category: 'fitness',
    stock: 20,
    createdAt: new Date('2024-02-01')
  }
];

export const getMockProducts = async (): Promise<Product[]> => {
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 500));
  return mockProducts;
};

export const getMockProduct = async (id: string): Promise<Product | null> => {
  await new Promise(resolve => setTimeout(resolve, 300));
  return mockProducts.find(product => product.id === id) || null;
};
