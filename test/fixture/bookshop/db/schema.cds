namespace bookshop;

entity Authors {
  key ID    : Integer;
      name  : String(111);
      books : Association to many Books
                on books.author = $self;
}

entity Books {
  key ID     : Integer;
      title  : String(111);
      author : Association to Authors;
      stock  : Integer;
      price  : Decimal(9, 2);
}

entity Orders {
  key ID        : UUID;
      book      : Association to Books;
      quantity  : Integer;
      orderedAt : Timestamp;
}
