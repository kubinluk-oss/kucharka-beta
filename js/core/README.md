# Jádro Kuchařky (`js/core`)

Jak appka funguje, bez jakéhokoli vzhledu. Nové rozhraní importuje odsud a nic jiného ze staré appky.
Data ve Firebase jsou SDÍLENÁ s ostrou appkou — strukturu dokumentů neměnit.

| Soubor | Co dělá |
|---|---|
| `firebase.js` | připojení k Firebase (jediné místo s konfigurací) |
| `auth.js` | přihlášení: `watchAuth(cb)` → stavy `signed-out` / `verify-email` / `need-name` / `ready`; `signInWithEmail`, `signUpWithEmail`, `signInWithGoogle`, `checkRedirectResult`, `sendPasswordReset`, `resendVerification` + `resendWaitSeconds`, `recheckEmailVerified`, `setDisplayName`, `changePassword`, `signOut`, `authErrorMessage(e)` |
| `data.js` | stav a operace (níže) |
| `util.js` | čisté výpočty: jednotky, přepočet porcí (`qtyLabel`, `scaleQty`), oddělení obchodu (`STORE_CATEGORIES`, `classifyIngredient`), `plural`, `formatTime`, `compressImage`, `aiPromptText` … |
| `demo.js` | ukázková data |

## `data.js`
- **Start/stop:** `startLive(user, { preferGroup })`, `startDemo()`, `openPublicRecipe(id, gid)`, `stop()`, `retry()`
- **Stav:** `state` (recipes, categories, catStyles, groups, activeGroup, shopping, sharedLists, loaded, loadError, mode …)
- **Události:** `on('data' | 'groups' | 'shopping' | 'status' | 'notice', fn)` — vrací funkci pro odhlášení
- **Oprávnění:** `myName`, `isMine`, `canEditRecipe`, `canMoveRecipe`, `assignableAuthors`, `canDeleteReview`, `isGroupOwner`, `categoriesEditable`
- **Recepty:** `getRecipe`, `listRecipes(cat, { filters, sort })`, `searchRecipes(q, 'name'|'ingredients', …)`, `saveRecipe(id|null, fields, { targets, assignTo })`, `deleteRecipe`, `addReview`, `deleteReview`, `setRecipeShared`, `shareUrl`, `copyRecipeToGroup`, `copyTargets`, `getCheckedSteps`/`setCheckedSteps`, `recipeGroupsOf`, `catCount`, `primaryCategory`
- **Kategorie:** `addCategory`, `reorderCategories`, `setCategoryStyle`, `renameCategory`, `deleteCategory`
- **Skupiny:** `switchGroup`, `isAggregate`, `groupLabel`, `createGroup`, `joinGroup(kód)`, `renameGroup`, `regenerateCode`, `removeMember`, `leaveGroup`, `deleteGroup`
- **Profil:** `renameMe`, `photoFor(jméno)`, `setMyAvatarPhoto(dataUrl)`, `removeMyAvatarPhoto`, `saveHighScore`
- **Nákup:** `selectShopList`, `setShoppingItems(items)`, `addShoppingItem`, `addRecipeToShopping(id, mult)`, `createSharedList(people)`, `addSharedListPeople`, `removeSharedListPerson`, `leaveSharedList`, `deleteSharedList`, `shareablePeople`, `isSharedListOwner`, `isShopListNew`

Zapisující funkce při chybě vyhazují výjimku — co říct uživateli, řeší rozhraní.
Ověření: `core-test.html` (ukázková data tlačítkem; přihlášený účet se načte sám).
