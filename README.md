# dotDock

An open source nothing inspired theme launcher for windows! with bunch of features!
**website** - 

## what is this?
its a theme to change the whole look of windows , I personally hate the default look and the taskbar , I see people making so many launcher and stuff , but somehow I never felt like using them for long , So I thought Ill make myself . I lwk like Nothing theme so decided to make the launcher on similar theme .
There are basically 3 big features -

1- you can customize your whole home screen , add/remove/resize widgets , with many themes/wallpapers options prebuilt in app , but you can still use yours or import on the app .

2- theres a whole different dock instead of windows taskbar , which has many widgets , very functional , easy to custamize , apps in different categories , a whole app library(personal fav feature)

3- A notch which sees what your ai harness or any ai tool is doing , it has pretty cool animation , it notifies you if the agent needs you , when job is done , etc .

## how its different from other themes
1- its open source 
2 - its a local app , no sign up thingy , no cookies on websites .
3- its the best because im saying .

## why its not a slop
ive been coding for more than 3 years now , im still a learner , ive made slop projects , I know which are which are not .
Ive worked for more than 5 days now on this(still somehow hacktime tracked only around 40hrs), and I know how hard it was to fix , debugg all those minute errors and layout , more than 1000 tests pass , 7 times live testing for each feature . So idc if its ai gen as long it works well. Still ik it still be having bugs which ill eventually fix when I get to know :)

# run locally 
```bash
git clone https://github.com/nAItiklearn/dotDock.git
cd dotDock/apps/desktop
pnpm install
pnpm tauri dev
```

The first build compiles the Rust core and takes a few minutes; later starts are fast. While the dotDock theme is on, the dock takes the taskbar's place. Quit from the tray icon, or switch the theme off in Settings, and the taskbar comes back.

### Work on the interface only

Each part of the interface also runs in a normal browser with sample data, without the Rust core:

```bash
cd apps/desktop
pnpm dev
```

Then open http://localhost:1420/dock.html (the dock), `/island.html` (the notch), `/overlay.html` (the home screen) or `/settings.html` (Settings). A small panel marked "DEV ONLY" switches the sample states.

### Tests

```bash
cd apps/desktop
pnpm typecheck
pnpm test             itest)
cd src-tauri
cargo test --workspace
```

### Build an installer

```bash
cd apps/desktop
pnpm tauri build
```


### If something goes wrong

`tools/restore-windows.ps1` puts your Windows desktop back as it was
before dotDock: the tach at sign-in. Run itfrom PowerShell:

```powershell
powershell -ExecutionPore-windows.ps1
```

### The website

```bash
cd website
pnpm install
pnpm dev          # ht
```