import type { Analysis, SourceFile } from './types';
export const demoFiles: SourceFile[] = [{ path: 'example.ts', content: `type Item = {
  price: number;
  quantity: number;
};

// Calculate an order total, including tax.
export function calculateTotal(
  items: Item[],
  taxRate = 0.08,
): number {
  const subtotal = items.reduce((total, item) => {
    return total + item.price * item.quantity;
  }, 0);

  const tax = subtotal * taxRate;
  return Math.round((subtotal + tax) * 100) / 100;
}

const basket: Item[] = [
  { price: 24, quantity: 2 },
  { price: 12, quantity: 1 },
];

const total = calculateTotal(basket);
console.log(total); // 64.8
` }];
export const demoAnalysis: Analysis = {
 summary: 'A small checkout calculation. Item describes the input, calculateTotal combines prices and tax, and the basket shows how the pieces fit together.',
 steps: [
  {title:'Describe an item',startLine:1,endLine:4,explanation:'Item defines the shape of each basket entry: a price and a quantity, both numbers. The type lets TypeScript check the inputs to calculateTotal before the code runs.'},
  {title:'Set up the calculation',startLine:6,endLine:10,explanation:'calculateTotal accepts an array of items and an optional tax rate. If the caller leaves out taxRate, it uses 0.08, or 8%. The function returns a number.'},
  {title:'Add up the basket',startLine:11,endLine:13,explanation:'reduce visits each item and carries a running total, beginning at zero. For each entry, price multiplied by quantity is added to that total. The example basket has a subtotal of 60.'},
  {title:'Apply tax and round',startLine:15,endLine:17,explanation:'The subtotal is multiplied by the tax rate to calculate tax. The return expression adds the tax and rounds the result to two decimal places. With a subtotal of 60 and 8% tax, the total is 64.8. Floating-point arithmetic can introduce small rounding errors in financial calculations.'},
  {title:'Connect the pieces',startLine:19,endLine:25,explanation:'The basket contains two items priced at 24 and one item priced at 12. calculateTotal receives this array, uses its default tax rate, and returns 64.8. console.log prints the result.'},
 ]
};
