using bookshop from '../db/schema';

@agent
@protocol: ['odata', 'agent']
service CatalogService {
  entity Books   as projection on bookshop.Books;
  entity Authors as projection on bookshop.Authors;
  entity Orders  as projection on bookshop.Orders;

  action submitOrder(book : Books:ID, quantity : Integer) returns {
    stock : Integer
  };
}

annotate CatalogService.submitOrder with @agent.hitl;
