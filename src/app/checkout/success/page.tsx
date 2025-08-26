'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle, ArrowLeft } from 'lucide-react';
import Button from '@/components/ui/Button';

export default function CheckoutSuccessPage() {
  return (
    <div className="min-h-screen py-8">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <div className="bg-white p-8 rounded-lg shadow-md">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-6" />
          
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Order Confirmed!
          </h1>
          
          <p className="text-lg text-gray-600 mb-8">
            Thank you for your purchase. Your order has been successfully placed and you will receive a confirmation email shortly.
          </p>
          
          <div className="space-y-4">
            <Link href="/">
              <Button className="w-full">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Continue Shopping
              </Button>
            </Link>
            
            <Link href="/admin">
              <Button variant="outline" className="w-full">
                View Orders (Admin)
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
