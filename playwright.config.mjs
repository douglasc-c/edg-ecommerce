import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./test/browser',workers:1,timeout:60000,
  use:{locale:'es-ES',baseURL:'http://localhost:3100',viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  projects:[
    {name:'chromium',use:{browserName:'chromium',launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS||'[]')}:{}}},
    {name:'webkit',testMatch:/(hero|carousel|header|account-menu|loading|api-errors)\.spec\.mjs$/,use:{browserName:'webkit',launchOptions:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE}:{}}},
  ],
  webServer:{command:'node test/ui-server.mjs',url:'http://localhost:3100/api/health',reuseExistingServer:false,timeout:30000},
});
