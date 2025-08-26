import React from 'react';
import Image from 'next/image';
import { CartItem } from '@/types';
import { formatPrice } from '@/lib/stripe';
import Button from '@/components/ui/Button';
import { Minus, Plus, Trash2, ShoppingBag } from 'lucide-react';

interface CartProps {
  cart: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemoveItem: (productId: string) => void;
  onCheckout: () => void;
}

const Cart: React.FC<CartProps> = ({ cart, onUpdateQuantity, onRemoveItem, onCheckout }) => {
  const total = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

  if (cart.length === 0) {
    return (
      <div className="text-center py-12">
        <ShoppingBag className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">Your cart is empty</h3>
        <p className="text-gray-500">Add some products to get started!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Shopping Cart</h2>
      
      <div className="space-y-4">
        {cart.map((item) => (
          <div key={item.product.id} className="flex items-center space-x-4 p-4 bg-white rounded-lg border">
            <div className="flex-shrink-0">
              <Image
                src={item.product.imageUrl}
                alt={item.product.name}
                width={80}
                height={80}
                className="w-20 h-20 object-cover rounded-md"
              />
            </div>
            
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-medium text-gray-900 truncate">
                {item.product.name}
              </h3>
              <p className="text-gray-500 text-sm">
                {formatPrice(item.product.price)} each
              </p>
            </div>
            
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateQuantity(item.product.id, item.quantity - 1)}
                disabled={item.quantity <= 1}
              >
                <Minus className="w-4 h-4" />
              </Button>
              
              <span className="w-12 text-center font-medium">
                {item.quantity}
              </span>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => onUpdateQuantity(item.product.id, item.quantity + 1)}
                disabled={item.quantity >= item.product.stock}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="text-right">
              <p className="text-lg font-semibold text-gray-900">
                {formatPrice(item.product.price * item.quantity)}
              </p>
            </div>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemoveItem(item.product.id)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
      
      <div className="border-t pt-6">
        <div className="flex justify-between items-center mb-6">
          <span className="text-xl font-semibold text-gray-900">Total:</span>
          <span className="text-2xl font-bold text-blue-600">
            {formatPrice(total)}
          </span>
        </div>
        
        <Button
          onClick={onCheckout}
          className="w-full"
          size="lg"
        >
          Proceed to Checkout
        </Button>
      </div>
    </div>
  );
};

export default Cart;
