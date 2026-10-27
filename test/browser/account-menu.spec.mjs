import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';

for(const scenario of [
  {name:'escritorio',viewport:{width:1440,height:1000},mobile:false},
  {name:'móvil',viewport:{width:390,height:844},mobile:true},
])test.describe(scenario.name,()=>{
  test.use({viewport:scenario.viewport,isMobile:scenario.mobile,hasTouch:scenario.mobile});

  test('el visitante no recibe enlaces de pedidos y el icono abre el acceso',async({page})=>{
    for(const route of ['/','/#cart','/#orders','/#skate','/#musica']){
      await page.goto(route);
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(page.locator('a[href="#orders"]')).toHaveCount(0);
      await expect(page.locator('#account-menu')).toHaveCount(0);
      await expect(page.getByRole('banner').getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();
    }
    if(scenario.mobile){
      await page.getByRole('button',{name:'Abrir menú',exact:true}).tap();
      await expect(page.locator('#store-menu')).toBeVisible();
      await expect(page.locator('#store-menu a[href="#orders"]')).toHaveCount(0);
      await page.getByRole('button',{name:'Cerrar menú',exact:true}).tap();
    }
    await page.getByRole('banner').getByRole('button',{name:'Iniciar sesión',exact:true}).click();
    await expect(page.locator('#auth-form')).toBeVisible();
  });

  test('la cuenta permite consultar pedidos, cambiar contraseña y salir sin dejar accesos privados',async({page})=>{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    const email=`account-menu-${randomUUID()}@example.test`,password='UI-account-menu-fixture-2026',nextPassword='UI-account-menu-updated-2026';
    await page.goto('/');
    const header=page.getByRole('banner'),toggle=header.locator('[data-account-toggle]'),menu=page.locator('#account-menu');
    await header.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
    await page.getByRole('button',{name:'Crear mi cuenta',exact:true}).click();
    await page.getByLabel('Nombre completo').fill('Cliente Cuenta');
    await page.getByLabel('Correo electrónico',{exact:true}).fill(email);
    await page.getByLabel('Contraseña',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Crear cuenta',exact:true}).click();
    await expect(page.locator('#dialog')).toBeHidden();
    await expect(toggle).toBeVisible();
    await expect(header.locator('.toplinks a[href="#orders"]')).toHaveCount(0);
    await expect(menu).toBeHidden();
    await page.reload();
    await expect(toggle).toBeVisible();

    if(scenario.mobile)await toggle.tap();else await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded','true');
    await expect(menu.getByRole('link',{name:'Mis pedidos',exact:true})).toBeVisible();
    await expect(menu.getByRole('button',{name:'Contraseña',exact:true})).toBeVisible();
    await expect(menu.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();
    const bounds=await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x+bounds.width).toBeLessThanOrEqual(scenario.viewport.width);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.press('Enter');
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('link',{name:'Mis pedidos',exact:true})).toBeFocused();
    await page.keyboard.press('Escape');
    await toggle.click();
    await page.locator('.campaign').click({position:{x:4,y:4}});
    await expect(menu).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded','false');

    // An open account must remain usable while the directional header scrolls.
    await toggle.click();
    await page.evaluate(()=>window.scrollTo({top:600,behavior:'instant'}));
    await expect(header).toHaveClass(/is-scrolled/);
    await expect(header).not.toHaveClass(/is-scroll-hidden/);
    await expect(menu).toBeInViewport({ratio:1});
    await header.locator('[data-language-select]').focus();
    await header.locator('[data-language-select]').selectOption('pt-BR');
    await toggle.click();
    await expect(menu.getByRole('link',{name:'Meus pedidos',exact:true})).toBeVisible();
    await expect(menu.getByRole('button',{name:'Senha',exact:true})).toBeVisible();
    await expect(menu.getByRole('button',{name:'Sair',exact:true})).toBeVisible();
    await header.locator('[data-language-select]').focus();
    await header.locator('[data-language-select]').selectOption('es');
    await toggle.click();
    await menu.getByRole('link',{name:'Mis pedidos',exact:true}).click();
    await expect(page).toHaveURL(/#orders$/);
    await expect(page.getByRole('heading',{name:'Mis pedidos',exact:true})).toBeVisible();
    await expect(menu).toBeHidden();
    await toggle.click();
    await menu.getByRole('button',{name:'Contraseña',exact:true}).click();
    await expect(menu).toBeHidden();
    await page.getByLabel('Contraseña actual',{exact:true}).fill(password);
    await page.getByLabel('Nueva contraseña',{exact:true}).fill(nextPassword);
    await page.getByRole('button',{name:'Guardar contraseña',exact:true}).click();
    await expect(header.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();
    await expect(page.locator('a[href="#orders"]')).toHaveCount(0);
    if(!await page.locator('#auth-form').isVisible())await header.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
    await page.getByLabel('Correo electrónico',{exact:true}).fill(email);
    await page.getByLabel('Contraseña',{exact:true}).fill(nextPassword);
    await page.locator('#auth-form').getByRole('button',{name:'Iniciar sesión',exact:true}).click();
    await expect(page.locator('#dialog')).toBeHidden();
    await toggle.click();
    await menu.getByRole('button',{name:'Cerrar sesión',exact:true}).click();
    await expect(header.getByRole('button',{name:'Iniciar sesión',exact:true})).toBeVisible();
    await expect(page.locator('a[href="#orders"]')).toHaveCount(0);
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
});
