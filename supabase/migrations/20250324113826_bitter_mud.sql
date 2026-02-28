/*
  # Add Product Images Support

  1. Changes
    - Add image_url column to products table
    - Add description column for better product details
    - Add comments for documentation
*/

-- Add new columns to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS image_url text,
ADD COLUMN IF NOT EXISTS description text;

-- Add comments
COMMENT ON COLUMN products.image_url IS 'URL of the product image';
COMMENT ON COLUMN products.description IS 'Detailed description of the product';