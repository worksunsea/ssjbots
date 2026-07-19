-- Swap in the actual packaging photo (open box + card + closed box) for
-- 100mg Lakshmi Gold Coin, so the card shows the real fixed box/card shape
-- customers actually receive, not just the bare coin.
update corporate_gifting_products
set image_url = 'https://img.jewelflix.com/indigo-prints4170/products/jkgtvet5t6ujnars0xex'
where id = '2a057c13-bbb1-4a06-8d1c-b4bdce461775';
