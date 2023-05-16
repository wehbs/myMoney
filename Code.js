function onInstall(e) {
  onOpen(e);
}

function onOpen(e) {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('myMoney')
    .addItem('Open myMoney', 'showSidebar')
    .addToUi();
}

// Call this function to open the sidebar
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar.html')
    .setTitle('myMoney')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function openPlaidModal() {
  var plaid = getPlaidServiceInstance();
  var link_token = plaid.createLinkToken();

  var template = HtmlService.createTemplateFromFile('index');
  template.linkToken = link_token;
  var htmlOutput = template.evaluate().setWidth(450).setHeight(750);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Link Your Bank Account');
}

function linkBankAccount(public_token) {
  var plaid = getPlaidServiceInstance();
  plaid.getAccessToken(public_token);

  // Sync transactions immediately after linking the bank account
  var transactionsData = plaid.syncTransactions();
  // Make sure to pass the correct array to writeToSheet function
  var transactions = transactionsData.added;
  writeToSheet(transactions);
  // Writes the balance details to the balance history sheet
  var allAccountDetails = plaid.syncAccountBalances();
  writeBalanceHistoryToSheet(allAccountDetails);
}

function writeToSheet(transactions) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName('Transactions');

  if (!Array.isArray(transactions) || transactions.length === 0) {
    SpreadsheetApp.getUi().alert('No new transactions to update.');
    return;
  }

  // If the sheet doesn't exist, create it.
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Transactions');
    sheet.appendRow([
      "Date",
      "Name",
      "Amount",
      "Pending",
      "Category",
      "Account",
      "Mask",
      "Transaction ID",
      "Pending Transaction ID",
    ]);
  }

  // Convert transactions to a 2D array
  var data = transactions.map(function (transaction) {
    return [
      transaction.date,
      transaction.name,
      transaction.amount,
      transaction.pending,
      transaction.category[0],
      transaction.account_name,
      transaction.account_mask,
      transaction.transaction_id,
      transaction.pending_transaction_id,
    ];
  });

  // Append all transactions at once
  sheet.getRange(sheet.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);

  // Sort by date (column 1) in descending order
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort({ column: 1, ascending: false });
}

function writeBalanceHistoryToSheet(accountDetailsArray) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName('Balance History');

  // If the sheet doesn't exist, create it.
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Balance History');
    sheet.appendRow([
      "Date",
      "Mask",
      "Name",
      "Official Name",
      "Subtype",
      "Available Balance",
      "Current Balance",
      "Limit"
    ]);
  }

  // Convert accountDetails to a 2D array
  var currentDate = new Date();
  var data = [];
  for (var i = 0; i < accountDetailsArray.length; i++) {
    var accountDetails = accountDetailsArray[i];
    for (var accountId in accountDetails) {
      var account = accountDetails[accountId];
      data.push([
        currentDate,
        account.mask,
        account.name,
        account.official_name,
        account.subtype,
        account.available_balance,
        account.subtype === "credit card" ? account.current_balance * -1 : account.current_balance,
        account.limit,
      ]);
    }
  }

  // Append all account data at once
  sheet.getRange(sheet.getLastRow() + 1, 1, data.length, data[0].length).setValues(data);

  // Sort by date (column 1) in descending order
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).sort({ column: 1, ascending: false });
}

function syncAndWriteTransactions() {
  var plaid = getPlaidServiceInstance();
  var transactionsData = plaid.syncTransactions();
  // Make sure to pass the correct array to writeToSheet function
  var transactions = transactionsData.added;
  writeToSheet(transactions);
  // Writes the balance details to the balance history sheet
  var allAccountDetails = plaid.syncAccountBalances();
  writeBalanceHistoryToSheet(allAccountDetails);
}

function fetchBankAccounts() {
  var properties = PropertiesService.getScriptProperties().getProperties();

  var bankAccounts = [];

  for (var key in properties) {
    if (key.startsWith('PLAID_ACCESS_TOKEN_')) {
      var itemId = key.split('PLAID_ACCESS_TOKEN_')[1];
      var officialNames = JSON.parse(properties['PLAID_OFFICIAL_NAMES_' + itemId]);

      // Push an object with the item id and official names to the bankAccounts array
      bankAccounts.push({
        id: itemId,
        names: officialNames
      });
    }
  }

  return bankAccounts;
}

function removeBankAccount(itemId) {
  var plaidService = getPlaidServiceInstance();
  return plaidService.deleteBankAccount(itemId);
}



