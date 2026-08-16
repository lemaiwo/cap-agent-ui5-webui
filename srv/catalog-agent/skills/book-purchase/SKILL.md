---
name: book-purchase
description: Order one or more copies of a book for the user.
---

# Book Purchase

## When to use

The user asks to buy, order, or reserve a book.

## Workflow

1. Identify the book. If the user gave a title rather than an ID, query the
   catalog to resolve it. If more than one title matches, ask which they mean.
2. Determine the quantity. Assume 1 only if the user clearly implies a single copy.
3. Check the current stock. If stock is lower than the requested quantity, tell
   the user how many are available and stop.
4. Call `submitOrder` with the book ID and quantity. This action requires human
   approval, so expect the request to pause.
5. Report the outcome using the remaining stock returned by the action.

## Examples

- "I'd like two copies of The Raven" → resolve The Raven, then order quantity 2.
- "Order book 1" → order book ID 1, quantity 1.
- "Buy every copy of Jane Eyre" → ask how many copies they want.
