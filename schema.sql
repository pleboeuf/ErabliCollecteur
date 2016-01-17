 CREATE TABLE Raw_Events (
     Event_no integer, # index
     device_id varchar(30),
     Published_at timestamp,
     eTime integer,
     serialNo integer,
     raw_data varchar(70)
 );

CREATE TABLE Devices (
    device_id varchar(30),
    device_name varchar(10),
);
CREATE TABLE Coulee (
    No_coulee integer, #index
    theDate timestamp,
    eTime integer,
    Numero integer,
    Debut timestamp,
    Fin timestamp
);

CREATE TABLE Cycles (
    No_cycle integer, #index
    Pompe_No integer,
    T0 timestamp, #event eTime
    T1 timestamp, #event eTime
    T2 timestamp #event eTime
);

CREATE TABLE Pompes (
    Reading_no integer, #index
    No_pompe integer,
    theDate timestamp,
    Etat boolean,
    Flow FLOAT,
);

CREATE TABLE Reservoir (
    Date timestamp,
    Nom varchar(10),
    Niveau DECIMAL(5,1), # Pourcentage
    Volume integer
);

CREATE TABLE Valves (
    theDate timestamp,
    Nom varchar(10),
    Etat varchar(10) #"open", "close", "undefined"
);
