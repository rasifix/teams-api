// Create a user for the teams database
db = db.getSiblingDB('teams');

// Create a user with read/write access to the teams database
db.createUser({
  user: 'teamsapi',
  pwd: 'teamsapi123',
  roles: [
    {
      role: 'readWrite',
      db: 'teams'
    }
  ]
});

print('Teams database and user created successfully');