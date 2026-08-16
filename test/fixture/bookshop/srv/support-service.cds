using bookshop from '../db/schema';

@agent
@agent.connect: 'none'
@protocol: ['odata', 'agent']
service SupportService {
  entity Orders as projection on bookshop.Orders;
}
