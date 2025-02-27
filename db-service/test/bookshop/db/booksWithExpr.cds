namespace booksCalc;

entity Books {
  key ID : Integer;
  title : String;
  author : Association to Authors;

  length : Decimal;
  width : Decimal;
  height : Decimal;
  stock : Integer;
  price : Decimal;

  // ---
  stock2 = stock;
  ctitle = substring(title, 3, stock);

  // -- nested
  areaS : Decimal = (length * width) stored;
  area : Decimal = length * width;
  volume : Decimal = area * height;
  storageVolume : Decimal = stock * volume;

  // -- with paths
  authorLastName = author.lastName;
  authorName = author.name;
  authorFullName = author.firstName || ' ' || author.lastName;
  authorFullNameWithAddress = authorFullName || ' ' || authorAdrText;
  authorAdrText = author.addressText;
}

entity Authors {
  key ID : Integer;
  firstName : String;
  lastName : String;
 
  books : Association to many Books on books.author = $self;
  address : Association to Addresses;

  name : String = firstName || ' ' || lastName;

  addressText = address.text;
  addressTextFilter = address[num2 > 17].text;

  IBAN = countryCode || checksum || sortCode  || accountNumber;
  countryCode = 'DE';
  checksum: String(2);
  sortCode: String(8);
  accountNumber: String(10);
}

entity Addresses {
  key ID : Integer;
  street : String;
  city : String;
  number : Integer;

  text = street || ', ' || city;
  num2 = number * 2;
}

entity LBooks {
  key ID : Integer;

  title : localized String;
  // ctitle = substring(title, 3, 3);  // requires compiler 4.1

  length : Decimal;
  width : Decimal;
  area : Decimal = length * width;
}
