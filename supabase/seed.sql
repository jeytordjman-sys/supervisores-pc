-- Dados de arranque (opcional): checklist e lojas de exemplo, sem supervisor atribuído.
-- Executar depois de schema.sql. Atribua depois as lojas no Bastidor → Configuração.

insert into public.items (id, label, action, days, owner, active) values
 (1,'Merchandising','Repor a implantação conforme o plano de merchandising em vigor (montras, gôndolas, testers).',7,'Responsável loja',true),
 (2,'Limpeza','Limpeza completa da loja (vitrines, espelhos, testers, chão, provador).',2,'Responsável loja',true),
 (3,'Apresentação da equipa','Relembrar à equipa as regras de farda e apresentação.',3,'Responsável loja',true),
 (4,'Stock / reposição','Verificar ruturas e fazer pedido de reposição ao armazém.',5,'Supervisor',true),
 (5,'Afixação de preços','Corrigir etiquetas de preço e cartazes de promoção em falta ou errados.',2,'Responsável loja',true),
 (6,'Briefing da equipa','Fazer o briefing da equipa (objetivos do mês, promoções, novidades).',7,'Responsável loja',true)
on conflict (id) do nothing;

insert into public.stores (id, name, code, city, address, phone, hours, team, manager, email, cad, lat, lng, priority) values
 (1,'P&C Colombo','L001','Lisboa','CC Colombo, Av. Lusíada, loja 0.112','','10h–23h',6,'','', 'A',38.7536,-9.1886,'Normal'),
 (2,'P&C Vasco da Gama','L002','Lisboa','CC Vasco da Gama, piso 1','','10h–23h',4,'','', 'B',38.7682,-9.0967,'Normal'),
 (3,'P&C Cascais','L003','Cascais','CascaiShopping, piso 0','','10h–23h',5,'','', 'C',38.7071,-9.4213,'Normal'),
 (4,'P&C NorteShopping','L010','Matosinhos','NorteShopping, piso 0','','10h–23h',7,'','', 'A',41.1813,-8.6494,'Normal'),
 (5,'P&C Braga Parque','L011','Braga','Braga Parque, piso 1','','10h–23h',4,'','', 'B',41.5607,-8.4030,'Normal'),
 (6,'P&C Coimbra','L020','Coimbra','Forum Coimbra, piso 1','','10h–23h',4,'','', 'C',40.1902,-8.4318,'Normal'),
 (7,'P&C Setúbal','L004','Setúbal','Alegro Setúbal, piso 1','','10h–22h',3,'','', 'B',38.5244,-8.8882,'Normal'),
 (8,'P&C Guimarães','L012','Guimarães','Guimarães Shopping, piso 0','','10h–23h',3,'','', 'C',41.4425,-8.2918,'Normal')
on conflict (id) do nothing;
