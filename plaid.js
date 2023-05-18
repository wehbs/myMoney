function PlaidService() {
  var CLIENT_ID =
    PropertiesService.getScriptProperties().getProperty("PLAID_CLIENT_ID");
  var SECRET =
    PropertiesService.getScriptProperties().getProperty("PLAID_SECRET");
  var BASE_URL = "https://development.plaid.com";

  this.createLinkToken = function () {
    var payload = {
      client_id: CLIENT_ID,
      secret: SECRET,
      user: {
        client_user_id: "unique-user-id", // replace with a unique user ID from your system
      },
      client_name: "myMoney",
      products: ["transactions"],
      country_codes: ["US"],
      language: "en",
    };

    var options = {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      payload: JSON.stringify(payload),
    };

    var response = UrlFetchApp.fetch(BASE_URL + "/link/token/create", options);
    var jsonResponse = JSON.parse(response.getContentText());
    return jsonResponse.link_token;
  };

  // Takes the link_token and retrieves an access_token
  this.getAccessToken = function (public_token) {
    var payload = {
      client_id: CLIENT_ID,
      secret: SECRET,
      public_token: public_token,
    };

    var options = {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      payload: JSON.stringify(payload),
    };

    var response = UrlFetchApp.fetch(
      BASE_URL + "/item/public_token/exchange",
      options
    );
    var jsonResponse = JSON.parse(response.getContentText());
    var access_token = jsonResponse.access_token;
    var item_id = jsonResponse.item_id;

    // Save the access_token in ScriptProperties with item_id
    PropertiesService.getScriptProperties().setProperty(
      "PLAID_ACCESS_TOKEN_" + item_id,
      access_token
    );

    // Get the account details
    var accountDetails = this.getAccountDetails(access_token);

    // Extract the official names from the account details
    var officialNames = Object.values(accountDetails).map(function (account) {
      return account.official_name;
    });

    // Save the official names in ScriptProperties
    PropertiesService.getScriptProperties().setProperty(
      "PLAID_OFFICIAL_NAMES_" + item_id,
      JSON.stringify(officialNames)
    );
  };

  this.getAccountDetails = function (access_token) {
    var options = {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      payload: JSON.stringify({
        client_id: CLIENT_ID,
        secret: SECRET,
        access_token: access_token,
      }),
    };

    var response = UrlFetchApp.fetch(
      BASE_URL + "/accounts/balance/get",
      options
    );
    var jsonResponse = JSON.parse(response.getContentText());

    var accountDetails = {};
    jsonResponse.accounts.forEach(function (account) {
      accountDetails[account.account_id] = {
        name: account.name,
        mask: account.mask,
        official_name: account.official_name,
        subtype: account.subtype,
        available_balance: account.balances.available,
        current_balance:
          account.subtype === "credit card"
            ? account.balances.current * -1
            : account.balances.current,
        limit: account.balances.limit,
      };
    });

    return accountDetails;
  };

  this.syncAccountBalances = function () {
    var properties = PropertiesService.getScriptProperties().getProperties();
    var allAccountDetails = [];

    for (var key in properties) {
      if (key.startsWith("PLAID_ACCESS_TOKEN_")) {
        var item_id = key.split("PLAID_ACCESS_TOKEN_")[1];
        var access_token = properties[key];

        // Get the account details
        var accountDetails = this.getAccountDetails(access_token);

        // Add account details to the array
        allAccountDetails.push(accountDetails);
      }
    }

    return allAccountDetails;
  };

  this.syncTransactions = function () {
    var properties = PropertiesService.getScriptProperties().getProperties();

    var allTransactions = {
      added: [],
      modified: [],
      removed: [],
    };

    for (var key in properties) {
      if (key.startsWith("PLAID_ACCESS_TOKEN_")) {
        var item_id = key.split("PLAID_ACCESS_TOKEN_")[1];
        var access_token = properties[key];
        var cursor = properties["PLAID_CURSOR_ID_" + item_id] || "";

        // Get the account details
        var accountDetails = this.getAccountDetails(access_token);

        var hasMore = true;

        while (hasMore) {
          var options = {
            method: "post",
            headers: {
              "Content-Type": "application/json",
            },
            payload: JSON.stringify({
              client_id: CLIENT_ID,
              secret: SECRET,
              access_token: access_token,
              cursor: cursor,
              count: 100,
            }),
          };

          var response = UrlFetchApp.fetch(
            BASE_URL + "/transactions/sync",
            options
          );
          var jsonResponse = JSON.parse(response.getContentText());
          Logger.log(jsonResponse); // log the response

          // Enrich transactions with additional data
          var addedWithDetails = jsonResponse.added.map(function (transaction) {
            transaction.account_name =
              accountDetails[transaction.account_id].name || "Unknown";
            transaction.account_mask =
              accountDetails[transaction.account_id].mask || "Unknown";
            return transaction;
          });
          var modifiedWithDetails = jsonResponse.modified.map(function (
            transaction
          ) {
            transaction.account_name =
              accountDetails[transaction.account_id].name || "Unknown";
            transaction.account_mask =
              accountDetails[transaction.account_id].mask || "Unknown";
            return transaction;
          });

          allTransactions.added =
            allTransactions.added.concat(addedWithDetails);
          allTransactions.modified =
            allTransactions.modified.concat(modifiedWithDetails);
          allTransactions.removed = allTransactions.removed.concat(
            jsonResponse.removed
          );

          hasMore = jsonResponse.has_more;
          cursor = jsonResponse.next_cursor;
        }

        // Save cursor in your database
        PropertiesService.getScriptProperties().setProperty(
          "PLAID_CURSOR_ID_" + item_id,
          cursor
        );
      }
    }

    // Return the transaction updates
    return allTransactions;
  };

  this.deleteBankAccount = function (itemId) {
    var properties = PropertiesService.getScriptProperties();
    var access_token = properties.getProperty("PLAID_ACCESS_TOKEN_" + itemId);

    var options = {
      method: "post",
      headers: {
        "Content-Type": "application/json",
      },
      payload: JSON.stringify({
        client_id: CLIENT_ID,
        secret: SECRET,
        access_token: access_token,
      }),
    };

    var response = UrlFetchApp.fetch(BASE_URL + "/item/remove", options);
    var data = JSON.parse(response.getContentText());

    if (data.request_id) {
      // Check if the request was successful
      // Delete the access token and cursor from the script properties
      properties.deleteProperty("PLAID_ACCESS_TOKEN_" + itemId);
      properties.deleteProperty("PLAID_CURSOR_ID_" + itemId);
      properties.deleteProperty("PLAID_OFFICIAL_NAMES_" + itemId);
    }

    return data;
  };
}

function getPlaidServiceInstance() {
  return new PlaidService();
}
